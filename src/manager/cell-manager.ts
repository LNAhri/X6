import * as util from '../util'
import { constants } from '../common'
import { BaseManager } from './manager-base'
import { EdgeStyle } from '../stylesheet'
import { Graph, Cell, Geometry, State } from '../core'
import { CellStyle, Align, VAlign } from '../types'
import { Point, Rectangle, Overlay, Image, Shapes, Constraint } from '../struct'

export class CellManager extends BaseManager {
  constructor(graph: Graph) {
    super(graph)
  }

  // #region :::::::::::: Creating

  createNode(options: Graph.CreateNodeOptions): Cell {
    const geom = new Geometry(
      options.x,
      options.y,
      options.width,
      options.height,
    )
    geom.relative = options.relative != null ? options.relative : false
    if (options.offset != null) {
      geom.offset = Point.clone(options.offset)
    }

    const node = new Cell(options.data, geom, options.style)
    node.setId(options.id)
    node.asNode(true)

    if (options.visible != null) {
      node.setVisible(options.visible)
    } else {
      node.setVisible(true)
    }

    if (options.connectable != null) {
      node.setConnectable(options.connectable)
    } else {
      node.setConnectable(true)
    }

    if (options.collapsed != null) {
      node.setCollapsed(options.collapsed)
    }

    if (options.overlays != null) {
      node.setOverlays(options.overlays)
    }

    return node
  }

  createEdge(options: Graph.CreateEdgeOptions): Cell {
    const geom = new Geometry()
    geom.relative = true

    if (options.sourcePoint != null) {
      geom.sourcePoint = Point.clone(options.sourcePoint)
    }

    if (options.targetPoint != null) {
      geom.targetPoint = Point.clone(options.targetPoint)
    }

    if (options.offset != null) {
      geom.offset = Point.clone(options.offset)
    }

    if (options.points != null) {
      geom.points = options.points.map(p => Point.clone(p))
    }

    const edge = new Cell(options.data, geom, options.style)
    edge.setId(options.id)
    edge.asEdge(true)

    if (options.visible != null) {
      edge.setVisible(options.visible)
    } else {
      edge.setVisible(true)
    }

    if (options.overlays != null) {
      edge.setOverlays(options.overlays)
    }

    return edge
  }

  addCells(
    cells: Cell[],
    parent: Cell,
    index: number,
    sourceNode?: Cell,
    targetNode?: Cell,
  ) {
    this.model.batchUpdate(() => {
      this.graph.trigger(
        Graph.events.addCells,
        { cells, parent, index, sourceNode, targetNode },
      )

      this.cellsAdded(
        cells, parent, index, sourceNode, targetNode, false, true,
      )
    })

    return cells
  }

  protected cellsAdded(
    cells: Cell[],
    parent: Cell,
    index: number,
    sourceNode?: Cell | null,
    targetNode?: Cell | null,
    absolute?: boolean,
    constrain?: boolean,
    extend?: boolean,
  ) {
    if (cells != null && parent != null && index != null) {
      this.model.batchUpdate(() => {
        const pState = absolute ? this.view.getState(parent) : null
        const o1 = (pState != null) ? pState.origin : null
        const zero = new Point(0, 0)

        for (let i = 0, ii = cells.length; i < ii; i += 1) {
          if (cells[i] == null) {
            index -= 1 // tslint:disable-line
            continue
          }

          const oldParent = this.model.getParent(cells[i])

          // Keeps the cell at its absolute location
          if (o1 != null && cells[i] !== parent && parent !== oldParent) {
            const oldState = this.view.getState(oldParent)
            const o2 = (oldState != null) ? oldState.origin : zero
            let geo = this.model.getGeometry(cells[i])

            if (geo != null) {
              const dx = o2.x - o1.x
              const dy = o2.y - o1.y

              geo = geo.clone()
              geo.translate(dx, dy)

              if (
                !geo.relative &&
                !this.graph.isAllowNegativeCoordinates() &&
                this.model.isNode(cells[i])
              ) {
                geo.bounds.x = Math.max(0, geo.bounds.x)
                geo.bounds.y = Math.max(0, geo.bounds.y)
              }

              this.model.setGeometry(cells[i], geo)
            }
          }

          // Decrements all following indices if cell is already in parent
          if (
            parent === oldParent &&
            index + i > this.model.getChildCount(parent)
          ) {
            index -= 1 // tslint:disable-line
          }

          this.model.add(parent, cells[i], index + i)

          if (this.graph.autoSizeOnAdded) {
            this.autoSizeCell(cells[i], true)
          }

          // Extends the parent or constrains the child
          if (
            (extend == null || extend) &&
            this.graph.isExtendParentsOnAdd() &&
            this.graph.isExtendParent(cells[i])
          ) {
            this.extendParent(cells[i])
          }

          // Additionally constrains the child after extending the parent
          if (constrain == null || constrain) {
            this.constrainChild(cells[i])
          }

          // Sets the source terminal
          if (sourceNode != null) {
            this.cellConnected(cells[i], sourceNode, true)
          }

          // Sets the target terminal
          if (targetNode != null) {
            this.cellConnected(cells[i], targetNode, false)
          }
        }

        this.graph.trigger(
          Graph.events.cellsAdded,
          { cells, parent, index, sourceNode, targetNode, absolute },
        )
      })
    }
  }

  removeCells(cells: Cell[], includeEdges: boolean) {
    let removing: Cell[]

    if (includeEdges) {
      removing = this.graph.getDeletableCells(this.addAllEdges(cells))
    } else {
      removing = cells.slice()

      // Removes edges that are currently not
      // visible as those cannot be updated
      const edges = this.graph.getDeletableCells(this.getAllEdges(cells))
      const dict = new WeakMap<Cell, boolean>()

      cells.forEach(cell => (dict.set(cell, true)))
      edges.forEach((edge) => {
        if (this.view.getState(edge) == null && !dict.get(edge)) {
          dict.set(edge, true)
          removing.push(edge)
        }
      })
    }

    this.model.batchUpdate(() => {
      this.graph.trigger(Graph.events.removeCells, {
        includeEdges,
        cells: removing,
      })
      this.cellsRemoved(removing)
    })

    return removing
  }

  /**
   * Returns an array with the given cells and all edges that are connected
   * to a cell or one of its descendants.
   */
  protected addAllEdges(cells: Cell[]) {
    const merged = [
      ...cells,
      ...this.getAllEdges(cells),
    ]
    return util.removeDuplicates<Cell>(merged)
  }

  getAllEdges(cells: Cell[]) {
    const edges: Cell[] = []
    if (cells != null) {
      cells.forEach((cell) => {
        cell.eachEdge(edge => edges.push(edge))
        const children = this.model.getChildren(cell)
        edges.push(...this.getAllEdges(children))
      })
    }

    return edges
  }

  protected cellsRemoved(cells: Cell[]) {
    if (cells != null && cells.length > 0) {
      this.model.batchUpdate(() => {
        const dict = new WeakMap<Cell, boolean>()
        cells.forEach(cell => (dict.set(cell, true)))
        cells.forEach((cell) => {
          const edges = this.getAllEdges([cell])
          edges.forEach((edge) => {
            if (!dict.get(edge)) {
              dict.set(edge, true)
              this.disconnectTerminal(cell, edge, true)
              this.disconnectTerminal(cell, edge, false)
            }
          })

          this.model.remove(cell)
        })

        this.graph.trigger(Graph.events.cellsRemoved, { cells })
      })
    }
  }

  protected disconnectTerminal(cell: Cell, edge: Cell, isSource: boolean) {
    const scale = this.view.scale
    const trans = this.view.translate

    let geo = this.model.getGeometry(edge)
    if (geo != null) {
      // Checks if terminal is being removed
      const terminal = this.model.getTerminal(edge, isSource)
      let connected = false
      let tmp = terminal

      while (tmp != null) {
        if (cell === tmp) {
          connected = true
          break
        }

        tmp = this.model.getParent(tmp)
      }

      if (connected) {
        geo = geo.clone()
        const state = this.view.getState(edge)

        if (state != null && state.absolutePoints != null) {
          const pts = state.absolutePoints
          const n = isSource ? 0 : pts.length - 1

          geo.setTerminalPoint(
            new Point(
              pts[n].x / scale - trans.x - state.origin.x,
              pts[n].y / scale - trans.y - state.origin.y,
            ),
            isSource,
          )
        } else { // fallback
          const state = this.view.getState(terminal)
          if (state != null) {
            geo.setTerminalPoint(
              new Point(
                state.bounds.getCenterX() / scale - trans.x,
                state.bounds.getCenterY() / scale - trans.y,
              ),
              isSource,
            )
          }
        }

        this.model.setGeometry(edge, geo)
        this.model.setTerminal(edge, null, isSource)
      }
    }
  }

  splitEdge(
    edge: Cell,
    cells: Cell[],
    newEdge: Cell | null,
    dx: number,
    dy: number,
  ) {
    this.model.batchUpdate(() => {
      const parent = this.model.getParent(edge)
      const source = this.model.getTerminal(edge, true)

      if (newEdge == null) {
        newEdge = this.graph.cloneCell(edge) // tslint:disable-line

        // Removes waypoints before/after new cell
        const state = this.view.getState(edge)
        let geo = this.graph.getCellGeometry(newEdge)

        if (geo != null && geo.points != null && state != null) {
          const t = this.view.translate
          const s = this.view.scale
          const idx = util.findNearestSegment(
            state,
            (dx + t.x) * s,
            (dy + t.y) * s,
          )

          geo.points = geo.points.slice(0, idx)

          geo = this.graph.getCellGeometry(edge)

          if (geo != null && geo.points != null) {
            geo = geo.clone()
            geo.points = geo.points.slice(idx)
            this.model.setGeometry(edge, geo)
          }
        }
      }

      this.cellsMoved(cells, dx, dy, false, false)

      let index = this.model.getChildCount(parent)
      this.cellsAdded(cells, parent!, index, null, null, true)

      index = this.model.getChildCount(parent)
      this.cellsAdded([newEdge], parent!, index, source, cells[0], false)
      this.cellConnected(edge, cells[0], true)

      this.graph.trigger(
        Graph.events.splitEdge,
        { edge, cells, newEdge, dx, dy },
      )
    })

    return newEdge
  }

  cloneCells(
    cells: Cell[],
    allowInvalidEdges: boolean = true,
    mapping: WeakMap<Cell, Cell> = new WeakMap<Cell, Cell>(),
    keepPosition: boolean = false,
  ) {
    let clones: Cell[] = []
    if (cells != null) {
      // Creates a dictionary for fast lookups
      const dict = new WeakMap<Cell, boolean>()
      const tmp = []

      cells.forEach((cell) => {
        dict.set(cell, true)
        tmp.push(cell)
      })

      if (tmp.length > 0) {
        const scale = this.view.scale
        const trans = this.view.translate

        clones = this.model.cloneCells(cells, true, mapping) as Cell[]

        for (let i = 0, ii = cells.length; i < ii; i += 1) {
          if (
            !allowInvalidEdges &&
            this.model.isEdge(clones[i]!) &&
            !this.graph.isEdgeValid(
              clones[i],
              this.model.getTerminal(clones[i], true),
              this.model.getTerminal(clones[i], false),
            )
          ) {
            (clones as any)[i] = null
          } else {
            const geom = this.model.getGeometry(clones[i]!)
            if (geom != null) {
              const state = this.view.getState(cells[i])
              const pstate = this.view.getState(this.model.getParent(cells[i])!)

              if (state != null && pstate != null) {
                const dx = keepPosition ? 0 : pstate.origin.x
                const dy = keepPosition ? 0 : pstate.origin.y

                if (this.model.isEdge(clones[i])) {
                  const pts = state.absolutePoints
                  if (pts != null) {
                    // Checks if the source is cloned or sets the terminal point
                    let source = this.model.getTerminal(cells[i], true)
                    while (source != null && !dict.get(source)) {
                      source = this.model.getParent(source)
                    }

                    if (source == null && pts[0] != null) {
                      geom.setTerminalPoint(
                        new Point(
                          pts[0]!.x / scale - trans.x,
                          pts[0]!.y / scale - trans.y,
                        ),
                        true,
                      )
                    }

                    // Checks if the target is cloned or sets the terminal point
                    let target = this.model.getTerminal(cells[i], false)
                    while (target != null && !dict.get(target)) {
                      target = this.model.getParent(target)
                    }

                    const n = pts.length - 1

                    if (target == null && pts[n] != null) {
                      geom.setTerminalPoint(
                        new Point(
                          pts[n]!.x / scale - trans.x,
                          pts[n]!.y / scale - trans.y,
                        ),
                        false,
                      )
                    }

                    // Translates the control points
                    geom.points && geom.points.forEach((p) => {
                      p.x += dx
                      p.y += dy
                    })
                  }
                } else {
                  geom.translate(dx, dy)
                }
              }
            }
          }
        }
      }
    }

    return clones
  }

  // #endregion

  // #region :::::::::::: Grouping

  groupCells(group: Cell, border: number, cells: Cell[]) {
    cells = this.getCellsForGroup(cells) // tslint:disable-line

    if (group == null) {
      group = this.graph.createGroup(cells) // tslint:disable-line
    }

    if (cells.length > 0) {
      const bounds = this.getBoundsForGroup(group, cells, border)
      if (bounds != null) {
        // Uses parent of group or previous parent of first child
        let parent = this.model.getParent(group)
        if (parent == null) {
          parent = this.model.getParent(cells[0])
        }

        this.model.batchUpdate(() => {
          // Ensure the group's geometry
          if (this.graph.getCellGeometry(group) == null) {
            this.model.setGeometry(group, new Geometry())
          }

          // Adds the group into the parent
          let index = this.model.getChildCount(parent!)
          this.cellsAdded(
            [group], parent!, index, null, null, false, false, false,
          )

          // Adds the children into the group and moves
          index = this.model.getChildCount(group)
          this.cellsAdded(cells, group, index, null, null, false, false, false)
          this.cellsMoved(cells, -bounds.x, -bounds.y, false, false, false)

          // Resizes the group
          this.cellsResized([group], [bounds], false)

          this.graph.trigger(Graph.events.groupCells, { group, cells, border })
        })
      }
    }

    return group
  }

  /**
   * Returns the cells with the same parent as the first cell
   * in the given array.
   */
  protected getCellsForGroup(cells: Cell[]) {
    const result = []

    if (cells != null && cells.length > 0) {
      const parent = this.model.getParent(cells[0])
      result.push(cells[0])

      // Filters selection cells with the same parent
      for (let i = 1, ii = cells.length; i < ii; i += 1) {
        if (this.model.getParent(cells[i]) === parent) {
          result.push(cells[i])
        }
      }
    }

    return result
  }

  /**
   * Returns the bounds to be used for the given group and children.
   */
  protected getBoundsForGroup(group: Cell, children: Cell[], border: number) {
    const result = this.graph.getBoundingBoxFromGeometry(children, true)
    if (result != null) {
      if (this.graph.isSwimlane(group)) {
        const size = this.graph.getStartSize(group)

        result.x -= size.width
        result.y -= size.height
        result.width += size.width
        result.height += size.height
      }

      // Adds the border
      if (border != null) {
        result.x -= border
        result.y -= border
        result.width += 2 * border
        result.height += 2 * border
      }
    }

    return result
  }

  ungroupCells(cells?: Cell[]) {
    let result: Cell[] = []

    if (cells == null) {
      const selected = this.graph.getSelectedCells()
      // Finds the cells with children
      // tslint:disable-next-line
      cells = selected.filter(cell => this.model.getChildCount(cell) > 0)
    }

    if (cells != null && cells.length > 0) {
      this.model.batchUpdate(() => {
        cells!.forEach((cell) => {
          let children = this.model.getChildren(cell)
          if (children != null && children.length > 0) {
            children = children.slice()
            const parent = this.model.getParent(cell)!
            const index = this.model.getChildCount(parent)

            this.cellsAdded(children, parent, index, null, null, true)
            result = result.concat(children)
          }
        })

        this.removeGroupsAfterUngroup(cells!)
        this.graph.trigger(Graph.events.ungroupCells, { cells })
      })
    }

    return result
  }

  removeGroupsAfterUngroup(cells: Cell[]) {
    this.cellsRemoved(this.addAllEdges(cells))
  }

  removeCellsFromParent(cells: Cell[]) {
    this.model.batchUpdate(() => {
      const parent = this.graph.getDefaultParent()!
      const index = this.model.getChildCount(parent)

      this.cellsAdded(cells, parent, index, null, null, true)
      this.graph.trigger(Graph.events.removeCellsFromParent, { cells })
    })

    return cells
  }

  updateGroupBounds(
    cells: Cell[],
    border: number = 0,
    moveGroup: boolean = false,
    topBorder: number = 0,
    rightBorder: number = 0,
    bottomBorder: number = 0,
    leftBorder: number = 0,
  ) {
    this.model.batchUpdate(() => {
      for (let i = cells.length - 1; i >= 0; i -= 1) {

        let geo = this.graph.getCellGeometry(cells[i])
        if (geo != null) {

          const children = this.graph.getChildCells(cells[i])
          if (children != null && children.length > 0) {

            const bounds = this.graph.getBoundingBoxFromGeometry(children, true)
            if (bounds != null && bounds.width > 0 && bounds.height > 0) {
              let left = 0
              let top = 0

              // Adds the size of the title area for swimlanes
              if (this.graph.isSwimlane(cells[i])) {
                const size = this.graph.getStartSize(cells[i])
                left = size.width
                top = size.height
              }

              geo = geo.clone()

              if (moveGroup) {
                geo.bounds.x = Math.round(
                  geo.bounds.x + bounds.x - border - left - leftBorder,
                )

                geo.bounds.y = Math.round(
                  geo.bounds.y + bounds.y - border - top - topBorder,
                )
              }

              geo.bounds.width = Math.round(
                bounds.width + 2 * border + left + leftBorder + rightBorder,
              )

              geo.bounds.height = Math.round(
                bounds.height + 2 * border + top + topBorder + bottomBorder,
              )

              this.model.setGeometry(cells[i], geo)

              this.moveCells(
                children,
                border + left - bounds.x + leftBorder,
                border + top - bounds.y + topBorder,
              )
            }
          }
        }
      }
    })

    return cells
  }

  // #endregion

  // #region :::::::::::: Connection

  connectCell(
    edge: Cell,
    terminal: Cell | null,
    isSource: boolean,
    constraint?: Constraint,
  ) {
    this.model.batchUpdate(() => {
      const previous = this.model.getTerminal(edge, isSource)
      this.graph.trigger(Graph.events.connectCell, {
        edge, terminal, isSource, constraint, previous,
      })

      this.cellConnected(edge, terminal, isSource, constraint)
    })
    return edge
  }

  protected cellConnected(
    edge: Cell,
    terminal: Cell | null,
    isSource: boolean,
    constraint?: Constraint,
  ) {
    if (edge != null) {
      this.model.batchUpdate(() => {
        const previous = this.model.getTerminal(edge, isSource)

        // Updates the constraint
        this.setConnectionConstraint(edge, terminal, isSource, constraint)

        // Checks if the new terminal is a port, uses the ID of the port
        // in the style and the parent of the port as the actual terminal
        // of the edge.
        if (this.graph.isPortsEnabled()) {
          let id = null

          if (terminal != null && this.graph.isPort(terminal)) {
            id = terminal.getId()
            // tslint:disable-next-line
            terminal = this.graph.getTerminalForPort(terminal, isSource)!
          }

          if (id != null) {
            const key = isSource ? 'sourcePort' : 'targetPort'
            this.updateCellsStyle(key, id, [edge])
          }
        }

        this.model.setTerminal(edge, terminal, isSource)

        if (this.graph.resetEdgesOnConnect) {
          this.resetEdge(edge)
        }

        this.graph.trigger(Graph.events.cellConnected, {
          edge, terminal, isSource, previous, constraint,
        })
      })
    }
  }

  getConnectionConstraint(
    edgeState: State,
    terminalState?: State | null,
    isSource: boolean = false,
  ) {

    let point: Point | null = null
    const style = edgeState.style

    // connection point specified in style
    const x = isSource ? style.exitX : style.entryX
    if (x != null) {
      const y = isSource ? style.exitY : style.entryY
      if (y != null) {
        point = new Point(x, y)
      }
    }

    let perimeter = true
    let dx = 0
    let dy = 0

    if (point != null) {
      perimeter = (isSource
        ? style.exitPerimeter
        : style.entryPerimeter
      ) !== false

      // Add entry/exit offset
      dx = (isSource ? style.exitDx : style.entryDx) as number
      dy = (isSource ? style.exitDy : style.entryDy) as number

      dx = isFinite(dx) ? dx : 0
      dy = isFinite(dy) ? dy : 0
    }

    return new Constraint({ point, perimeter, dx, dy })
  }

  setConnectionConstraint(
    edge: Cell,
    terminal: Cell | null,
    isSource: boolean,
    constraint?: Constraint | null,
  ) {
    if (constraint != null) {
      this.model.batchUpdate(() => {
        if (constraint == null || constraint.point == null) {
          this.updateCellsStyle(isSource ? 'exitX' : 'entryX', null, [edge])
          this.updateCellsStyle(isSource ? 'exitY' : 'entryY', null, [edge])
          this.updateCellsStyle(isSource ? 'exitDx' : 'entryDx', null, [edge])
          this.updateCellsStyle(isSource ? 'exitDy' : 'entryDy', null, [edge])
          this.updateCellsStyle(
            isSource ? 'exitPerimeter' : 'entryPerimeter',
            null,
            [edge],
          )
        } else if (constraint.point != null) {

          this.updateCellsStyle(
            isSource ? 'exitX' : 'entryX',
            `${constraint.point.x}`,
            [edge],
          )
          this.updateCellsStyle(
            isSource ? 'exitY' : 'entryY',
            `${constraint.point.y}`,
            [edge],
          )
          this.updateCellsStyle(
            isSource ? 'exitDx' : 'entryDx',
            `${constraint.dx}`,
            [edge],
          )
          this.updateCellsStyle(
            isSource ? 'exitDy' : 'entryDy',
            `${constraint.dy}`,
            [edge],
          )

          // Only writes `false` since `true` is default
          if (!constraint.perimeter) {
            this.updateCellsStyle(
              isSource ? 'exitPerimeter' : 'entryPerimeter',
              false,
              [edge],
            )
          } else {
            this.updateCellsStyle(
              isSource ? 'exitPerimeter' : 'entryPerimeter',
              null,
              [edge],
            )
          }
        }
      })
    }
  }

  disconnectGraph(cells: Cell[]) {
    if (cells != null) {
      this.model.batchUpdate(() => {
        const s = this.view.scale
        const t = this.view.translate

        const dict = new WeakMap<Cell, boolean>()
        cells.forEach(c => (dict.set(c, true)))

        cells.forEach((edge) => {
          if (this.model.isEdge(edge)) {
            let geo = this.model.getGeometry(edge)
            if (geo != null) {
              const state = this.view.getState(edge)
              const pstate = this.view.getState(this.model.getParent(edge))

              if (state != null && pstate != null) {
                geo = geo.clone()

                const dx = -pstate.origin.x
                const dy = -pstate.origin.y
                const pts = state.absolutePoints

                let src = this.model.getTerminal(edge, true)
                if (
                  src != null &&
                  this.graph.isCellDisconnectable(edge, src, true)
                ) {

                  while (src != null && !dict.get(src)) {
                    src = this.model.getParent(src)
                  }

                  if (src == null) {
                    geo.setTerminalPoint(
                      new Point(
                        pts[0]!.x / s - t.x + dx,
                        pts[0]!.y / s - t.y + dy,
                      ),
                      true,
                    )
                    this.model.setTerminal(edge, null, true)
                  }
                }

                let trg = this.model.getTerminal(edge, false)
                if (
                  trg != null &&
                  this.graph.isCellDisconnectable(edge, trg, false)
                ) {

                  while (trg != null && !dict.get(trg)) {
                    trg = this.model.getParent(trg)
                  }

                  if (trg == null) {
                    const n = pts.length - 1
                    geo.setTerminalPoint(
                      new Point(
                        pts[n]!.x / s - t.x + dx,
                        pts[n]!.y / s - t.y + dy,
                      ),
                      false,
                    )
                    this.model.setTerminal(edge, null, false)
                  }
                }

                this.model.setGeometry(edge, geo)
              }
            }
          }
        })
      })
    }
  }

  /**
   * Returns the nearest point in the list of absolute points
   * or the center of the opposite terminal.
   */
  getConnectionPoint(
    terminalState: State,
    constraint: Constraint,
    round: boolean = true,
  ) {
    let result: Point | null = null

    if (terminalState != null && constraint.point != null) {
      const direction = terminalState.style.direction
      const bounds = this.view.getPerimeterBounds(terminalState)
      const cx = bounds.getCenter()

      let r1 = 0

      if (
        direction != null &&
        terminalState.style.anchorPointDirection !== false
      ) {
        if (direction === 'north') {
          r1 += 270
        } else if (direction === 'west') {
          r1 += 180
        } else if (direction === 'south') {
          r1 += 90
        }

        // Bounds need to be rotated by 90 degrees for further computation
        if (
          direction === 'north' ||
          direction === 'south'
        ) {
          bounds.rotate90()
        }
      }

      const scale = this.view.scale

      result = new Point(
        bounds.x + constraint.point.x * bounds.width + constraint.dx * scale,
        bounds.y + constraint.point.y * bounds.height + constraint.dy * scale,
      )

      // Rotation for direction before projection on perimeter
      let r2 = terminalState.style.rotation || 0

      if (constraint.perimeter) {
        if (r1 !== 0) {
          // Only 90 degrees steps possible here so no trig needed
          let cos = 0
          let sin = 0

          if (r1 === 90) {
            sin = 1
          } else if (r1 === 180) {
            cos = -1
          } else if (r1 === 270) {
            sin = -1
          }
          result = util.rotatePoint(result, cos, sin, cx)
        }

        result = this.view.getPerimeterPoint(terminalState, result, false)

      } else {
        r2 += r1

        if (this.model.isNode(terminalState.cell)) {
          const flipH = terminalState.style.flipH === true
          const flipV = terminalState.style.flipV === true

          if (flipH) {
            result.x = 2 * bounds.getCenterX() - result.x
          }

          if (flipV) {
            result.y = 2 * bounds.getCenterY() - result.y
          }
        }
      }

      // Generic rotation after projection on perimeter
      if (r2 !== 0 && result != null) {
        const rad = util.toRad(r2)
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        result = util.rotatePoint(result, cos, sin, cx)
      }
    }

    if (round && result != null) {
      result.x = Math.round(result.x)
      result.y = Math.round(result.y)
    }

    return result
  }

  getOutlineConstraint(point: Point, terminalState: State, me: any) {
    if (terminalState.shape != null) {
      const bounds = this.view.getPerimeterBounds(terminalState)
      const direction = terminalState.style.direction

      if (direction === 'north' || direction === 'south') {
        bounds.x += bounds.width / 2 - bounds.height / 2
        bounds.y += bounds.height / 2 - bounds.width / 2
        const tmp = bounds.width
        bounds.width = bounds.height
        bounds.height = tmp
      }

      const alpha = util.toRad(terminalState.shape.getShapeRotation())

      if (alpha !== 0) {
        const cos = Math.cos(-alpha)
        const sin = Math.sin(-alpha)

        const ct = new Point(bounds.getCenterX(), bounds.getCenterY())
        // tslint:disable-next-line
        point = util.rotatePoint(point, cos, sin, ct)
      }

      let sx = 1
      let sy = 1
      let dx = 0
      let dy = 0

      // LATER: Add flipping support for image shapes
      if (this.model.isNode(terminalState.cell)) {
        let flipH = terminalState.style.flipH
        let flipV = terminalState.style.flipV

        if (direction === 'north' || direction === 'south') {
          const tmp = flipH
          flipH = flipV
          flipV = tmp
        }

        if (flipH) {
          sx = -1
          dx = -bounds.width
        }

        if (flipV) {
          sy = -1
          dy = -bounds.height
        }
      }

      // tslint:disable-next-line
      point = new Point(
        (point.x - bounds.x) * sx - dx + bounds.x,
        (point.y - bounds.y) * sy - dy + bounds.y,
      )

      const x = (bounds.width === 0)
        ? 0
        : Math.round((point.x - bounds.x) * 1000 / bounds.width) / 1000

      const y = (bounds.height === 0)
        ? 0
        : Math.round((point.y - bounds.y) * 1000 / bounds.height) / 1000

      return new Constraint({ point: new Point(x, y), perimeter: false })
    }

    return null
  }

  /**
   * Returns true if perimeter points should be computed such that the
   * resulting edge has only horizontal or vertical segments.
   */
  isOrthogonal(state: State) {
    const orthogonal = state.style.orthogonal
    if (orthogonal != null) {
      return orthogonal
    }

    const tmp = this.view.getEdgeFunction(state)
    return (
      tmp === EdgeStyle.segmentConnector ||
      tmp === EdgeStyle.elbowConnector ||
      tmp === EdgeStyle.sideToSide ||
      tmp === EdgeStyle.topToBottom ||
      tmp === EdgeStyle.entityRelation ||
      tmp === EdgeStyle.orthConnector
    )
  }

  /**
   * Returns true if the given cell state is a loop.
   */
  isLoop(state: State) {
    const src = state.getVisibleTerminalState(true)
    const trg = state.getVisibleTerminalState(false)

    return (src != null && src === trg)
  }

  // #endregion

  // #region :::::::::::: Sizing

  autoSizeCell(cell: Cell, recurse: boolean) {
    if (recurse) {
      cell.eachChild(child => this.autoSizeCell(child, recurse))
    }

    if (this.model.isNode(cell) && this.graph.isAutoSizeCell(cell)) {
      this.updateCellSize(cell)
    }
  }

  updateCellSize(cell: Cell, ignoreChildren: boolean = false) {
    this.model.batchUpdate(() => {
      this.graph.trigger(Graph.events.updateCellSize, { cell, ignoreChildren })
      this.cellSizeUpdated(cell, ignoreChildren)
    })
    return cell
  }

  cellSizeUpdated(cell: Cell, ignoreChildren: boolean) {
    if (cell != null) {
      this.model.batchUpdate(() => {
        const size = this.getCellPreferredSize(cell)
        let geo = this.model.getGeometry(cell)
        if (size != null && geo != null) {
          const collapsed = this.graph.isCellCollapsed(cell)
          geo = geo.clone()

          if (this.graph.isSwimlane(cell)) {
            const style = this.graph.getStyle(cell)
            const cellStyle = this.model.getStyle(cell) || {}

            if (style.horizontal !== false) {
              cellStyle.startSize = size.height + 8

              if (collapsed) {
                geo.bounds.height = size.height + 8
              }

              geo.bounds.width = size.width

            } else {
              cellStyle.startSize = size.width + 8

              if (collapsed) {
                geo.bounds.width = size.width + 8
              }

              geo.bounds.height = size.height
            }

            this.model.setStyle(cell, cellStyle)

          } else {
            geo.bounds.width = size.width
            geo.bounds.height = size.height
          }

          if (!ignoreChildren && !collapsed) {
            const bounds = this.view.getBounds(this.model.getChildren(cell))
            if (bounds != null) {
              const t = this.view.translate
              const s = this.view.scale

              const width = (bounds.x + bounds.width) / s - geo.bounds.x - t.x
              const height = (bounds.y + bounds.height) / s - geo.bounds.y - t.y

              geo.bounds.width = Math.max(geo.bounds.width, width)
              geo.bounds.height = Math.max(geo.bounds.height, height)
            }
          }

          this.cellsResized([cell], [geo.bounds], false)
        }
      })
    }
  }

  protected getCellPreferredSize(cell: Cell) {
    let result = null

    if (cell != null && !this.model.isEdge(cell)) {
      const state = this.view.getState(cell, true)!
      const style = state.style
      const fontSize = style.fontSize || constants.DEFAULT_FONTSIZE

      let dx = 0
      let dy = 0

      // Adds dimension of image if shape is a label
      if (this.getImage(state) != null || style.image != null) {
        if (style.shape === Shapes.label) {
          if (style.verticalAlign === 'middle') {
            dx += style.imageWidth || 0
          }

          if (style.align !== 'center') {
            dy += style.imageHeight || 0
          }
        }
      }

      // Adds spacings
      dx += 2 * (style.spacing || 0)
      dx += style.spacingLeft || 0
      dx += style.spacingRight || 0

      dy += 2 * (style.spacing || 0)
      dy += style.spacingTop || 0
      dy += style.spacingBottom || 0

      // Add spacing for collapse/expand icon
      const image = this.graph.getFoldingImage(state)
      if (image != null) {
        dx += image.width + 8
      }

      // Adds space for label
      let value = this.renderer.getLabelValue(state)
      if (value != null && value.length > 0) {
        if (!this.graph.isHtmlLabel(state.cell)) {
          value = util.escape(value)
        }

        value = value.replace(/\n/g, '<br>')

        const size = util.getSizeForString(value, fontSize, style.fontFamily)
        let width = size.width + dx
        let height = size.height + dy

        if (style.horizontal === false) {
          const tmp = height

          height = width
          width = tmp
        }

        if (this.graph.gridEnabled) {
          width = this.graph.snap(width + this.graph.gridSize / 2)
          height = this.graph.snap(height + this.graph.gridSize / 2)
        }

        result = new Rectangle(0, 0, width, height)
      } else {
        const gs2 = 4 * this.graph.gridSize
        result = new Rectangle(0, 0, gs2, gs2)
      }
    }

    return result
  }

  resizeCells(cells: Cell[], bounds: Rectangle[], recurse: boolean) {
    this.model.batchUpdate(() => {
      this.graph.trigger(Graph.events.resizeCells, { cells, bounds })
      this.cellsResized(cells, bounds, recurse)
    })
    return cells
  }

  protected cellsResized(
    cells: Cell[],
    bounds: Rectangle[],
    recurse: boolean = false,
  ) {
    if (cells != null && bounds != null && cells.length === bounds.length) {
      this.model.batchUpdate(() => {
        for (let i = 0, ii = cells.length; i < ii; i += 1) {
          this.cellResized(cells[i], bounds[i], false, recurse)

          if (this.graph.isExtendParent(cells[i])) {
            this.extendParent(cells[i])
          }

          this.constrainChild(cells[i])
        }

        if (this.graph.resetEdgesOnResize) {
          this.resetOtherEdges(cells)
        }
      })

      this.graph.trigger(Graph.events.cellsResized, { cells, bounds })
    }
  }

  protected cellResized(
    cell: Cell,
    bounds: Rectangle,
    ignoreRelative: boolean,
    recurse: boolean,
  ) {
    let geo = this.model.getGeometry(cell)
    if (
      geo != null &&
      (
        geo.bounds.x !== bounds.x ||
        geo.bounds.y !== bounds.y ||
        geo.bounds.width !== bounds.width ||
        geo.bounds.height !== bounds.height
      )
    ) {
      geo = geo.clone()

      if (!ignoreRelative && geo.relative) {
        const offset = geo.offset

        if (offset != null) {
          offset.x += bounds.x - geo.bounds.x
          offset.y += bounds.y - geo.bounds.y
        }
      } else {
        geo.bounds.x = bounds.x
        geo.bounds.y = bounds.y
      }

      geo.bounds.width = bounds.width
      geo.bounds.height = bounds.height

      if (
        !geo.relative && this.model.isNode(cell) &&
        !this.graph.isAllowNegativeCoordinates()
      ) {
        geo.bounds.x = Math.max(0, geo.bounds.x)
        geo.bounds.y = Math.max(0, geo.bounds.y)
      }

      this.model.batchUpdate(() => {
        if (recurse) {
          this.graph.resizeChildCells(cell, geo!)
        }

        this.model.setGeometry(cell, geo!)
        this.constrainChildCells(cell)
      })
    }
  }

  scaleCell(cell: Cell, sx: number, sy: number, recurse: boolean) {
    let geo = this.model.getGeometry(cell)
    if (geo != null) {
      geo = geo.clone()

      // Stores values for restoring based on style
      const x = geo.bounds.x
      const y = geo.bounds.y
      const w = geo.bounds.width
      const h = geo.bounds.height

      const style = this.graph.getStyle(cell)
      geo.scale(sx, sy, style.aspect)

      if (style.resizeWidth === true) {
        geo.bounds.width = w * sx
      } else if (style.resizeWidth === false) {
        geo.bounds.width = w
      }

      if (style.resizeHeight === true) {
        geo.bounds.height = h * sy
      } else if (style.resizeHeight === false) {
        geo.bounds.height = h
      }

      if (!this.graph.isCellMovable(cell)) {
        geo.bounds.x = x
        geo.bounds.y = y
      }

      if (!this.graph.isCellResizable(cell)) {
        geo.bounds.width = w
        geo.bounds.height = h
      }

      if (this.model.isNode(cell)) {
        this.cellResized(cell, geo.bounds, true, recurse)
      } else {
        this.model.setGeometry(cell, geo)
      }
    }
  }

  /**
   * Resizes the parents recursively so that they contain the complete
   * area of the resized child cell.
   */
  protected extendParent(cell: Cell | null) {
    if (cell != null) {
      const parent = this.model.getParent(cell)
      let pgeo = this.graph.getCellGeometry(parent!)

      if (
        parent != null &&
        pgeo != null &&
        !this.graph.isCellCollapsed(parent)
      ) {
        const geo = this.graph.getCellGeometry(cell)

        if (
          geo != null &&
          !geo.relative &&
          (
            pgeo.bounds.width < geo.bounds.x + geo.bounds.width ||
            pgeo.bounds.height < geo.bounds.y + geo.bounds.height
          )
        ) {
          pgeo = pgeo.clone()

          pgeo.bounds.width = Math.max(
            pgeo.bounds.width,
            geo.bounds.x + geo.bounds.width,
          )

          pgeo.bounds.height = Math.max(
            pgeo.bounds.height,
            geo.bounds.y + geo.bounds.height,
          )

          this.cellsResized([parent], [pgeo.bounds], false)
        }
      }
    }
  }

  /**
   * Keeps the given cell inside the bounds.
   *
   * @param cell - The cell will be constrained.
   * @param  sizeFirst - Specifies if the size should be changed first.
   * Default is `true`.
   */
  constrainChild(cell: Cell, sizeFirst: boolean = true) {
    if (cell != null) {
      let geo = this.graph.getCellGeometry(cell)
      if (
        geo != null &&
        (this.graph.isConstrainRelativeChildren() || !geo.relative)
      ) {
        const parent = this.model.getParent(cell)!
        // const pgeo = this.getCellGeometry(parent)
        let max = this.graph.getMaximumGraphBounds()
        // Finds parent offset
        if (max != null) {
          const off = this.graph.getBoundingBoxFromGeometry([parent], false)
          if (off != null) {
            max = max.clone()
            max.x -= off.x
            max.y -= off.y
          }
        }

        if (this.graph.isConstrainChild(cell)) {
          let area = this.getCellContainmentArea(cell)
          if (area != null) {
            const overlap = this.graph.getOverlap(cell)

            if (overlap > 0) {
              area = Rectangle.clone(area)

              area.x -= area.width * overlap
              area.y -= area.height * overlap
              area.width += 2 * area.width * overlap
              area.height += 2 * area.height * overlap
            }

            // Find the intersection between max and tmp
            if (max == null) {
              max = area
            } else {
              max = Rectangle.clone(max)
              max.intersect(area)
            }
          }
        }

        if (max != null) {
          const cells = [cell]

          if (!this.graph.isCellCollapsed(cell)) {
            const desc = this.model.getDescendants(cell)

            for (let i = 0; i < desc.length; i += 1) {
              if (this.graph.isCellVisible(desc[i])) {
                cells.push(desc[i])
              }
            }
          }

          const bbox = this.graph.getBoundingBoxFromGeometry(cells, false)

          if (bbox != null) {
            geo = geo.clone()

            // Cumulative horizontal movement
            let dx = 0

            if (geo.bounds.width > max.width) {
              dx = geo.bounds.width - max.width
              geo.bounds.width -= dx
            }

            if (bbox.x + bbox.width > max.x + max.width) {
              dx -= bbox.x + bbox.width - max.x - max.width - dx
            }

            // Cumulative vertical movement
            let dy = 0

            if (geo.bounds.height > max.height) {
              dy = geo.bounds.height - max.height
              geo.bounds.height -= dy
            }

            if (bbox.y + bbox.height > max.y + max.height) {
              dy -= bbox.y + bbox.height - max.y - max.height - dy
            }

            if (bbox.x < max.x) {
              dx -= bbox.x - max.x
            }

            if (bbox.y < max.y) {
              dy -= bbox.y - max.y
            }

            if (dx !== 0 || dy !== 0) {
              if (geo.relative) {
                // Relative geometries are moved via absolute offset
                if (geo.offset == null) {
                  geo.offset = new Point()
                }

                geo.offset.x += dx
                geo.offset.y += dy
              } else {
                geo.bounds.x += dx
                geo.bounds.y += dy
              }
            }

            this.model.setGeometry(cell, geo)
          }
        }
      }
    }
  }

  /**
   * Constrains the children of the given cell.
   */
  constrainChildCells(cell: Cell) {
    cell.eachChild(child => this.constrainChild(child))
  }

  getCellContainmentArea(cell: Cell) {
    if (cell != null && !this.model.isEdge(cell)) {
      const parent = this.model.getParent(cell)
      if (parent != null && parent !== this.graph.getDefaultParent()) {
        const geo = this.model.getGeometry(parent)
        if (geo != null) {
          let x = 0
          let y = 0
          let w = geo.bounds.width
          let h = geo.bounds.height

          if (this.graph.isSwimlane(parent)) {
            const size = this.graph.getStartSize(parent)
            const style = this.graph.getStyle(parent)

            const dir = style.direction || 'east'
            const flipH = style.flipH === true
            const flipV = style.flipV === true

            if (dir === 'south' || dir === 'north') {
              const tmp = size.width
              size.width = size.height
              size.height = tmp
            }

            if (
              (dir === 'east' && !flipV) ||
              (dir === 'north' && !flipH) ||
              (dir === 'west' && flipV) ||
              (dir === 'south' && flipH)
            ) {
              x = size.width
              y = size.height
            }

            w -= size.width
            h -= size.height
          }

          return new Rectangle(x, y, w, h)
        }
      }
    }

    return null
  }

  getBoundingBox(cells: Cell[]) {
    let result: Rectangle | null = null

    if (cells == null || cells.length <= 0) {
      return result
    }

    cells.forEach((cell) => {
      if (this.model.isNode(cell) || this.model.isEdge(cell)) {
        const bbox = this.view.getBoundingBox(this.view.getState(cell), true)
        if (bbox != null) {
          if (result == null) {
            result = Rectangle.clone(bbox)
          } else {
            result.add(bbox)
          }
        }
      }
    })

    return result
  }

  // #endregion

  // #region :::::::::::: Moving

  moveCells(
    cells: Cell[],
    dx: number = 0,
    dy: number = 0,
    clone: boolean = false,
    target?: Cell | null,
    e?: MouseEvent,
    cache?: WeakMap<Cell, Cell>,
  ) {
    if (cells != null && (dx !== 0 || dy !== 0 || clone || target != null)) {
      // Removes descendants with ancestors in cells to avoid multiple moving
      cells = this.model.getTopmostCells(cells) // tslint:disable-line

      this.model.batchUpdate(() => {
        const dict = new WeakMap<Cell, boolean>()
        cells.forEach(c => (dict.set(c, true)))

        const isSelected = (cell: Cell | null) => {
          let node = cell
          while (node != null) {
            if (dict.get(node)) {
              return true
            }

            node = this.model.getParent(node)!
          }

          return false
        }

        // Removes relative edge labels with selected terminals
        const checked = []

        for (let i = 0; i < cells.length; i += 1) {
          const geo = this.graph.getCellGeometry(cells[i])
          const parent = this.model.getParent(cells[i])!

          if (
            (geo == null || !geo.relative) ||
            !this.model.isEdge(parent) ||
            (
              !isSelected(this.model.getTerminal(parent, true)) &&
              !isSelected(this.model.getTerminal(parent, false))
            )
          ) {
            checked.push(cells[i])
          }
        }

        // tslint:disable-next-line
        cells = checked

        if (clone) {
          // tslint:disable-next-line
          cells = this.cloneCells(cells, this.graph.isCloneInvalidEdges(), cache)!

          if (target == null) {
            // tslint:disable-next-line
            target = this.graph.getDefaultParent()!
          }
        }

        const previous = this.graph.isAllowNegativeCoordinates()

        if (target != null) {
          this.graph.setAllowNegativeCoordinates(true)
        }

        this.graph.trigger(
          Graph.events.moveCells,
          { cells, dx, dy, clone, target, e },
        )

        this.cellsMoved(
          cells, dx, dy,
          (
            !clone &&
            this.graph.isDisconnectOnMove() &&
            this.graph.isAllowDanglingEdges()
          ),
          target == null,
          this.graph.isExtendParentsOnMove() && target == null,
        )

        this.graph.setAllowNegativeCoordinates(previous)

        if (target != null) {
          const index = this.model.getChildCount(target)
          this.cellsAdded(cells, target, index, null, null, true)
        }
      })
    }

    return cells
  }

  protected cellsMoved(
    cells: Cell[],
    dx: number,
    dy: number,
    disconnect: boolean,
    constrain: boolean,
    extend: boolean = false,
  ) {
    if (cells != null && (dx !== 0 || dy !== 0)) {
      this.model.batchUpdate(() => {
        if (disconnect) {
          this.disconnectGraph(cells)
        }

        cells.forEach((cell) => {
          this.translateCell(cell, dx, dy)
          if (extend && this.graph.isExtendParent(cell)) {
            this.extendParent(cell)
          } else if (constrain) {
            this.constrainChild(cell)
          }
        })

        if (this.graph.resetEdgesOnMove) {
          this.resetOtherEdges(cells)
        }

        this.graph.trigger(
          Graph.events.cellsMoved,
          { cells, dx, dy, disconnect },
        )
      })
    }
  }

  translateCell(cell: Cell, dx: number, dy: number) {
    let geo = this.model.getGeometry(cell)
    if (geo != null) {
      geo = geo.clone()
      geo.translate(dx, dy)

      if (
        !geo.relative &&
        this.model.isNode(cell) &&
        !this.graph.isAllowNegativeCoordinates()
      ) {
        geo.bounds.x = Math.max(0, geo.bounds.x)
        geo.bounds.y = Math.max(0, geo.bounds.y)
      }

      if (geo.relative && !this.model.isEdge(cell)) {
        const parent = this.model.getParent(cell)!
        let angle = 0

        if (this.model.isNode(parent)) {
          const style = this.graph.getStyle(parent)
          angle = style.rotation || 0
        }

        if (angle !== 0) {
          const rad = util.toRad(-angle)
          const cos = Math.cos(rad)
          const sin = Math.sin(rad)
          const pt = util.rotatePoint(
            new Point(dx, dy), cos, sin, new Point(0, 0),
          )
          dx = pt.x // tslint:disable-line
          dy = pt.y // tslint:disable-line
        }

        if (geo.offset == null) {
          geo.offset = new Point(dx, dy)
        } else {
          geo.offset.x = geo.offset.x + dx
          geo.offset.y = geo.offset.y + dy
        }
      }

      this.model.setGeometry(cell, geo)
    }
  }

  resetOtherEdges(cells: Cell[]) {
    if (cells != null) {
      // Prepares faster cells lookup
      const dict = new WeakMap<Cell, boolean>()
      cells.forEach(c => (dict.set(c, true)))

      this.model.batchUpdate(() => {
        cells.forEach((cell) => {
          const edges = this.model.getEdges(cell)
          if (edges != null) {
            edges.forEach((edge) => {
              const [source, target] = this.getVisibleTerminals(edge)
              // Checks if one of the terminals is not in the given array
              if (!dict.get(source!) || !dict.get(target!)) {
                this.resetEdge(edge)
              }
            })
          }

          this.resetOtherEdges(this.model.getChildren(cell))
        })
      })
    }
  }

  /**
   * Resets the control points of the given edge.
   */
  resetEdge(edge: Cell) {
    let geo = this.model.getGeometry(edge)
    if (geo != null && geo.points != null && geo.points.length > 0) {
      geo = geo.clone()
      geo.points = []
      this.model.setGeometry(edge, geo)
    }
  }

  // #endregion

  // #region :::::::::::: Align

  alignCells(
    align: Align | VAlign,
    cells: Cell[],
    param?: number,
  ) {
    if (cells != null && cells.length > 1) {

      let coord = param

      // Finds the required coordinate for the alignment
      if (coord == null) {
        for (let i = 0, ii = cells.length; i < ii; i += 1) {
          const state = this.view.getState(cells[i])
          if (state != null && !this.model.isEdge(cells[i])) {
            if (coord == null) {
              if (align === 'center') {
                coord = state.bounds.x + state.bounds.width / 2
              } else if (align === 'right') {
                coord = state.bounds.x + state.bounds.width
              } else if (align === 'top') {
                coord = state.bounds.y
              } else if (align === 'middle') {
                coord = state.bounds.y + state.bounds.height / 2
              } else if (align === 'bottom') {
                coord = state.bounds.y + state.bounds.height
              } else {
                coord = state.bounds.x
              }
            } else {
              if (align === 'right') {
                coord = Math.max(coord, state.bounds.x + state.bounds.width)
              } else if (align === 'top') {
                coord = Math.min(coord, state.bounds.y)
              } else if (align === 'bottom') {
                coord = Math.max(coord, state.bounds.y + state.bounds.height)
              } else {
                coord = Math.min(coord, state.bounds.x)
              }
            }
          }
        }
      }

      // Aligns the cells to the coordinate
      this.model.batchUpdate(() => {
        const s = this.view.scale
        cells.forEach((cell) => {
          const state = this.view.getState(cell)
          if (state != null && coord != null) {
            const bounds = state.bounds
            let geo = this.graph.getCellGeometry(cell)
            if (geo != null && !this.model.isEdge(cell)) {
              geo = geo.clone()

              if (align === 'center') {
                geo.bounds.x += (coord - bounds.x - bounds.width / 2) / s
              } else if (align === 'right') {
                geo.bounds.x += (coord - bounds.x - bounds.width) / s
              } else if (align === 'top') {
                geo.bounds.y += (coord - bounds.y) / s
              } else if (align === 'middle') {
                geo.bounds.y += (coord - bounds.y - bounds.height / 2) / s
              } else if (align === 'bottom') {
                geo.bounds.y += (coord - bounds.y - bounds.height) / s
              } else {
                geo.bounds.x += (coord - bounds.x) / s
              }

              this.graph.resizeCell(cell, geo.bounds)
            }
          }
        })
      })

      this.graph.trigger(Graph.events.alignCells, { align, cells })
    }

    return cells
  }

  //#endregion

  // #region :::::::::::: Order

  orderCells(toBack: boolean, cells: Cell[]) {
    this.model.batchUpdate(() => {
      this.graph.trigger(Graph.events.orderCells, { cells, toBack })
      this.cellsOrdered(cells, toBack)
    })
    return cells
  }

  protected cellsOrdered(cells: Cell[], toBack: boolean) {
    if (cells != null) {
      this.model.batchUpdate(() => {
        cells.forEach((cell, i) => {
          const parent = this.model.getParent(cell)!

          if (toBack) {
            this.model.add(parent, cell, i)
          } else {
            this.model.add(
              parent, cell,
              this.model.getChildCount(parent) - 1,
            )
          }
        })

        this.graph.trigger(Graph.events.cellsOrdered, { cells, toBack })
      })
    }
  }

  //#endregion

  // #region :::::::::::: Visibility

  toggleCells(show: boolean, cells: Cell[], includeEdges: boolean) {
    const arr = includeEdges ? this.addAllEdges(cells) : cells
    this.model.batchUpdate(() => {
      this.graph.trigger(
        Graph.events.toggleCells,
        { show, includeEdges, cells: arr },
      )
      this.setCellsVisibleImpl(arr, show)
    })

    return arr
  }

  protected setCellsVisibleImpl(cells: Cell[], show: boolean) {
    if (cells != null && cells.length > 0) {
      this.model.batchUpdate(() => {
        cells.forEach(cell => this.model.setVisible(cell, show))
      })
    }
  }

  // #endregion

  // #region :::::::::::: Folding

  foldCells(
    collapse: boolean,
    recurse: boolean,
    cells: Cell[],
    checkFoldable: boolean,
  ) {
    this.graph.stopEditing(false)
    this.model.batchUpdate(() => {
      this.graph.trigger(Graph.events.foldCells, { collapse, recurse, cells })
      this.cellsFolded(cells, collapse, recurse, checkFoldable)
    })
    return cells
  }

  protected cellsFolded(
    cells: Cell[],
    collapse: boolean,
    recurse: boolean,
    checkFoldable: boolean = false,
  ) {
    if (cells != null && cells.length > 0) {
      this.model.batchUpdate(() => {
        cells.forEach((cell) => {
          if (
            (!checkFoldable || this.graph.isFoldable(cell, collapse)) &&
            collapse !== this.graph.isCellCollapsed(cell)
          ) {
            this.model.setCollapsed(cell, collapse)
            this.swapBounds(cell, collapse)

            if (this.graph.isExtendParent(cell)) {
              this.extendParent(cell)
            }

            if (recurse) {
              const children = this.model.getChildren(cell)
              this.cellsFolded(children, collapse, recurse)
            }

            this.constrainChild(cell)
          }
        })
      })
      this.graph.trigger(Graph.events.cellsFolded, { cells, collapse, recurse })
    }
  }

  protected swapBounds(cell: Cell, willCollapse: boolean) {
    if (cell != null) {
      let geo = this.model.getGeometry(cell)
      if (geo != null) {
        geo = geo.clone()
        this.updateAlternateBounds(cell, geo, willCollapse)
        geo.swap()
        this.model.setGeometry(cell, geo)
      }
    }
  }

  /**
   * Updates or sets the alternate bounds in the given geometry for the
   * given cell depending on whether the cell is going to be collapsed.
   * If no alternate bounds are defined in the geometry and
   * `collapseToPreferredSize` is true, then the preferred size is used for
   * the alternate bounds. The top, left corner is always kept at the same
   * location.
   */
  protected updateAlternateBounds(
    cell: Cell,
    geo: Geometry,
    willCollapse: boolean,
  ) {
    if (cell != null && geo != null) {
      const style = this.graph.getStyle(cell)

      if (geo.alternateBounds == null) {
        let bounds = geo.bounds

        if (this.graph.collapseToPreferredSize) {
          const tmp = this.getCellPreferredSize(cell)
          if (tmp != null) {
            bounds = tmp
            const startSize = style.startSize || 0
            if (startSize > 0) {
              bounds.height = Math.max(bounds.height, startSize)
            }
          }
        }

        geo.alternateBounds = new Rectangle(0, 0, bounds.width, bounds.height)
      }

      if (geo.alternateBounds != null) {
        geo.alternateBounds.x = geo.bounds.x
        geo.alternateBounds.y = geo.bounds.y

        const alpha = util.toRad(style.rotation || 0)
        if (alpha !== 0) {
          const dx = geo.alternateBounds.getCenterX() - geo.bounds.getCenterX()
          const dy = geo.alternateBounds.getCenterY() - geo.bounds.getCenterY()

          const cos = Math.cos(alpha)
          const sin = Math.sin(alpha)

          const dx2 = cos * dx - sin * dy
          const dy2 = sin * dx + cos * dy

          geo.alternateBounds.x += dx2 - dx
          geo.alternateBounds.y += dy2 - dy
        }
      }
    }
  }

  // #endregion

  // #region :::::::::::: Overlay

  addOverlay(cell: Cell, overlay: Overlay) {
    if (cell.overlays == null) {
      cell.overlays = []
    }

    cell.overlays.push(overlay)

    const state = this.view.getState(cell)
    if (state != null) {
      // Immediately updates the cell display if the state exists
      this.renderer.redraw(state)
    }

    this.graph.trigger(Graph.events.addOverlay, { cell, overlay })

    return overlay
  }

  removeOverlay(cell: Cell, overlay?: Overlay | null) {
    if (overlay == null) {
      return this.removeOverlays(cell)
    }

    const idx = cell.overlays != null ? cell.overlays.indexOf(overlay) : -1
    if (idx >= 0 && cell.overlays != null) {
      cell.overlays.splice(idx, 1)
      if (cell.overlays.length === 0) {
        delete cell.overlays
      }

      const state = this.view.getState(cell)
      if (state != null) {
        this.renderer.redraw(state)
      }

      this.graph.trigger(Graph.events.removeOverlay, { cell, overlay })

      return overlay
    }

    return null
  }

  removeOverlays(cell: Cell) {
    const overlays = cell.overlays
    if (overlays != null) {
      delete cell.overlays
      const state = this.view.getState(cell)
      if (state != null) {
        this.renderer.redraw(state)
      }

      this.graph.trigger(Graph.events.removeOverlays, { cell, overlays })
    }

    return overlays
  }

  addWarningOverlay(
    cell: Cell,
    warning: string | null,
    img: Image,
    selectOnClick: boolean,
  ) {
    const overlay = new Overlay(
      img,
      `<font color=red>${warning}</font>`,
    )

    // Adds a handler for single mouseclicks to select the cell
    if (selectOnClick) {
      // TODO:
      // overlay.addListener('click', () => {
      //   if (this.isEnabled()) {
      //     this.setSelectionCell(cell)
      //   }
      // })
    }

    return this.addOverlay(cell, overlay)
  }

  // #endregion

  // #region :::::::::::: Style

  getCellStyle(cell: Cell | null) {
    if (cell != null) {
      const defaultStyle = this.model.isEdge(cell)
        ? this.graph.styleSheet.getDefaultEdgeStyle()
        : this.graph.styleSheet.getDefaultNodeStyle()

      const style = this.model.getStyle(cell) || {}
      return {
        ...defaultStyle,
        ...style,
      }
    }

    return {}
  }

  setCellStyle(style: CellStyle, cells: Cell[]) {
    if (cells != null) {
      this.model.batchUpdate(() => {
        cells.forEach(cell => this.model.setStyle(cell, style))
      })
    }
  }

  updateCellsStyle(
    key: string,
    value?: string | number | boolean | null,
    cells?: Cell[],
  ) {
    if (cells != null && cells.length > 0) {
      this.model.batchUpdate(() => {
        cells.forEach((cell) => {
          if (cell != null) {
            const raw = this.model.getStyle(cell)
            const style = raw != null ? { ...raw } : {}
            if (value == null) {
              delete (style as any)[key]
            } else {
              (style as any)[key] = value
            }
            this.model.setStyle(cell, style)
          }
        })
      })
    }
  }

  toggleCellsStyle(
    key: string,
    defaultValue: boolean = false,
    cells: Cell[],
  ) {
    let value = null
    if (cells != null && cells.length > 0) {
      const state = this.view.getState(cells[0])
      const style = state != null ? state.style : this.getCellStyle(cells[0])
      if (style != null) {
        const cur = (style as any)[key]
        if (cur == null) {
          value = defaultValue
        } else {
          value = cur ? false : true
        }
        this.updateCellsStyle(key, value, cells)
      }
    }

    return value
  }

  setCellStyleFlags(
    key: string,
    flag: number,
    value: boolean | null,
    cells: Cell[],
  ) {
    if (cells != null && cells.length > 0) {
      if (value == null) {
        const style = this.graph.getStyle(cells[0])
        const current = parseInt((style as any)[key], 10) || 0
        value = !((current & flag) === flag) // tslint:disable-line
      }

      this.updateCellsStyle(key, value ? flag : null, cells)
    }
  }

  // #endregion

  // #region :::::::::::: Flip

  flipEdge(edge: Cell) {
    if (edge != null && this.graph.alternateEdgeStyle != null) {
      this.model.batchUpdate(() => {
        const style = this.model.getStyle(edge)
        if (style == null) {
          this.model.setStyle(edge, this.graph.alternateEdgeStyle)
        } else {
          this.model.setStyle(edge, {})
        }

        // Removes all control points
        this.resetEdge(edge)
        this.graph.trigger(Graph.events.flipEdge, { edge })
      })
    }

    return edge
  }

  //#endregion

  // #region :::::::::::: Drilldown

  enterGroup(cell: Cell) {
    if (cell != null && this.graph.isValidRoot(cell)) {
      this.view.setCurrentRoot(cell)
      this.graph.clearSelection()
    }
  }

  exitGroup() {
    const root = this.model.getRoot()
    const current = this.graph.getCurrentRoot()
    if (current != null) {
      let next = this.model.getParent(current)

      // Finds the next valid root in the hierarchy
      while (
        next !== root &&
        !this.graph.isValidRoot(next) &&
        this.model.getParent(next) !== root
      ) {
        next = this.model.getParent(next)!
      }

      // Clears the current root if the new root is
      // the model's root or one of the layers.
      if (next === root || this.model.getParent(next) === root) {
        this.view.setCurrentRoot(null)
      } else {
        this.view.setCurrentRoot(next)
      }

      // Selects the previous root in the graph
      const state = this.view.getState(current)
      if (state != null) {
        this.graph.setSelectedCell(current)
      }
    }
  }

  home() {
    const current = this.graph.getCurrentRoot()
    if (current != null) {
      this.view.setCurrentRoot(null)
      const state = this.view.getState(current)
      if (state != null) {
        this.graph.setSelectedCell(current)
      }
    }
  }

  //#endregion

  // #region :::::::::::: Retrieval

  getDefaultParent(): Cell {
    let parent = this.graph.getCurrentRoot()
    if (parent == null) {
      parent = this.graph.defaultParent
      if (parent == null) {
        const root = this.model.getRoot()
        parent = this.model.getChildAt(root, 0)
      }
    }

    return parent!
  }

  getSwimlane(cell: Cell | null) {
    let result = cell
    while (result != null && !this.graph.isSwimlane(result)) {
      result = this.model.getParent(result)
    }
    return result
  }

  getSwimlaneAt(x: number, y: number, parent: Cell): Cell | null {
    const count = this.model.getChildCount(parent)
    for (let i = 0; i < count; i += 1) {
      const child = this.model.getChildAt(parent, i)!
      const result = this.getSwimlaneAt(x, y, child)

      if (result != null) {
        return result
      }

      if (this.graph.isSwimlane(child)) {
        const state = this.view.getState(child)
        if (this.isIntersected(state, x, y)) {
          return child
        }
      }
    }

    return null
  }

  getCellAt(
    x: number,
    y: number,
    parent?: Cell | null,
    includeNodes: boolean = true,
    includeEdges: boolean = true,
    ignoreFn?: (state: State, x?: number, y?: number) => boolean,
  ): Cell | null {
    if (parent == null) {
      // tslint:disable-next-line
      parent = this.graph.getCurrentRoot() || this.model.getRoot()
    }

    if (parent != null) {
      const c = this.model.getChildCount(parent)
      for (let i = c - 1; i >= 0; i -= 1) {
        const cell = this.model.getChildAt(parent, i)!
        const result = this.getCellAt(
          x, y, cell, includeNodes, includeEdges, ignoreFn,
        )

        if (result != null) {
          return result
        }

        if (this.graph.isCellVisible(cell) && (
          (includeEdges && this.model.isEdge(cell)) ||
          (includeNodes && this.model.isNode(cell))
        )) {
          const state = this.view.getState(cell)
          if (
            state != null &&
            (ignoreFn == null || !ignoreFn(state, x, y)) &&
            this.isIntersected(state, x, y)
          ) {
            return cell
          }
        }
      }
    }

    return null
  }

  protected isIntersected(state: State | null, x: number, y: number) {
    if (state != null) {
      const points = state.absolutePoints
      if (points != null) {
        const hotspot = this.graph.tolerance * this.graph.tolerance
        let pt = points[0]!
        for (let i = 1, ii = points.length; i < ii; i += 1) {
          const next = points[i]!
          const dist = util.ptSegmentDist(pt.x, pt.y, next.x, next.y, x, y)
          if (dist <= hotspot) {
            return true
          }

          pt = next
        }
      } else {
        const alpha = util.toRad(util.getRotation(state))
        if (alpha !== 0) {
          const cos = Math.cos(-alpha)
          const sin = Math.sin(-alpha)
          const cx = state.bounds.getCenter()
          const pt = util.rotatePoint(new Point(x, y), cos, sin, cx)
          if (state.bounds.containsPoint(pt)) {
            return true
          }
        }

        if (state.bounds.containsPoint({ x, y })) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Returns true if the given point is inside the content of the
   * given swimlane.
   */
  hitsSwimlaneContent(swimlane: Cell | null, x: number, y: number) {
    const state = this.view.getState(swimlane)
    const size = this.graph.getStartSize(swimlane)

    if (state != null) {
      const scale = this.view.scale
      const dx = x - state.bounds.x
      const dy = y - state.bounds.y

      if (size.width > 0 && dx > 0 && dx > size.width * scale) {
        return true
      }

      if (size.height > 0 && dy > 0 && dy > size.height * scale) {
        return true
      }
    }

    return false
  }

  getEdges(
    node: Cell,
    parent?: Cell | null,
    incoming: boolean = true,
    outgoing: boolean = true,
    includeLoops: boolean = true,
    recurse: boolean = false,
  ) {
    const result: Cell[] = []
    const edges: Cell[] = []
    const isCollapsed = this.graph.isCellCollapsed(node)

    node.eachChild((child) => {
      if (isCollapsed || !this.graph.isCellVisible(child)) {
        edges.push(...this.model.getEdges(child, incoming, outgoing))
      }
    })

    edges.push(...this.model.getEdges(node, incoming, outgoing))

    edges.forEach((edge) => {
      const [source, target] = this.getVisibleTerminals(edge)

      if (source === target) {
        if (includeLoops) {
          result.push(edge)
        }
      } else {
        if (
          (
            incoming &&
            target === node &&
            (parent == null || this.isValidAncestor(source!, parent, recurse)))
          ||
          (
            outgoing &&
            source === node &&
            (parent == null || this.isValidAncestor(target!, parent, recurse))
          )
        ) {
          result.push(edge)
        }
      }
    })

    return result
  }

  protected getVisibleTerminals(edge: Cell) {
    const state = this.view.getState(edge)

    const source = state != null
      ? state.getVisibleTerminal(true)
      : this.view.getVisibleTerminal(edge, true)

    const target = state != null
      ? state.getVisibleTerminal(false)
      : this.view.getVisibleTerminal(edge, false)

    return [source, target]
  }

  protected isValidAncestor(cell: Cell, parent: Cell, recurse?: boolean) {
    return recurse
      ? this.model.isAncestor(parent, cell)
      : this.model.getParent(cell) === parent
  }

  getOppositeNodes(
    edges: Cell[],
    terminal: Cell,
    includeSources: boolean = true,
    includeTargets: boolean = true,
  ) {
    const result: Cell[] = []
    const map = new WeakMap<Cell, boolean>()
    const add = (cell: Cell) => {
      if (!map.get(cell)) {
        map.set(cell, true)
        result.push(cell)
      }
    }

    edges && edges.forEach((edge) => {
      const [source, target] = this.getVisibleTerminals(edge)

      if (
        source === terminal &&
        target != null &&
        target !== terminal &&
        includeTargets
      ) {
        add(target)
      } else if (
        target === terminal &&
        source != null &&
        source !== terminal &&
        includeSources
      ) {
        add(source)
      }
    })

    return result
  }

  getEdgesBetween(source: Cell, target: Cell, directed: boolean = false) {
    const edges = this.getEdges(source)
    const result: Cell[] = []

    edges && edges.forEach((edge) => {
      const [s, t] = this.getVisibleTerminals(edge)
      if (
        (s === source && t === target) ||
        (!directed && s === target && t === source)
      ) {
        result.push(edge)
      }
    })

    return result
  }

  getCellsInRegion(
    x: number,
    y: number,
    width: number,
    height: number,
    parent: Cell,
    result: Cell[] = [],
  ) {
    if (width > 0 || height > 0) {
      const rect = new Rectangle(x, y, width, height)

      parent && parent.eachChild((cell) => {
        const state = this.view.getState(cell)
        if (state != null && this.graph.isCellVisible(cell)) {
          const rot = util.getRotation(state)
          const bounds = rot === 0
            ? state.bounds
            : util.getBoundingBox(state.bounds, rot)

          if (
            (
              this.model.isEdge(cell) ||
              this.model.isNode(cell)
            ) &&
            rect.containsRect(bounds)
          ) {
            result.push(cell)
          } else {
            this.getCellsInRegion(x, y, width, height, cell, result)
          }
        }
      })
    }

    return result
  }

  getCellsBeyond(
    x: number,
    y: number,
    parent: Cell,
    isRight: boolean = false,
    isBottom: boolean = false,
  ) {
    const result: Cell[] = []

    if (isRight || isBottom) {
      parent && parent.eachChild((child) => {
        const state = this.view.getState(child)
        if (this.graph.isCellVisible(child) && state != null) {
          if (
            (!isRight || state.bounds.x >= x) &&
            (!isBottom || state.bounds.y >= y)
          ) {
            result.push(child)
          }
        }
      })
    }

    return result
  }

  findTreeRoots(
    parent: Cell | null,
    isolate: boolean = false,
    invert: boolean = false,
  ) {
    const roots: Cell[] = []

    let best = null
    let maxDiff = 0

    parent && parent.eachChild((cell) => {
      if (this.model.isNode(cell) && this.graph.isCellVisible(cell)) {
        const conns = this.graph.getConnections(cell, isolate ? parent : null)
        let fanOut = 0
        let fanIn = 0

        conns.forEach((conn) => {
          const src = this.view.getVisibleTerminal(conn, true)
          if (src === cell) {
            fanOut += 1
          } else {
            fanIn += 1
          }
        })

        if (
          (invert && fanOut === 0 && fanIn > 0) ||
          (!invert && fanIn === 0 && fanOut > 0)
        ) {
          roots.push(cell)
        }

        const diff = (invert) ? fanIn - fanOut : fanOut - fanIn

        if (diff > maxDiff) {
          maxDiff = diff
          best = cell
        }
      }
    })

    if (roots.length === 0 && best != null) {
      roots.push(best)
    }

    return roots
  }

  traverse(
    node: Cell,
    directed: boolean = true,
    func: (node: Cell, edge: Cell | null) => any,
    edge?: Cell,
    visited: WeakMap<Cell, boolean> = new WeakMap<Cell, boolean>(),
    inverse: boolean = false,
  ) {
    if (func != null && node != null) {
      if (!visited.get(node)) {
        visited.set(node, true)

        const result = func(node, edge || null)
        if (result !== false) {
          node.eachEdge((edge) => {
            const isSource = this.model.getTerminal(edge, true) === node
            if (!directed || (!inverse === isSource)) {
              const next = this.model.getTerminal(edge, !isSource)!
              this.traverse(next, directed, func, edge, visited, inverse)
            }
          })
        }
      }
    }
  }

  // #endregion

  // #region :::::::::::: State

  /**
   * Returns the string or DOM node that represents the tooltip for
   * the given state, node and coordinate pair.
   *
   * @param state The cell whose tooltip should be returned.
   * @param trigger DOM node that is currently under the mouse.
   * @param x X-coordinate of the mouse.
   * @param y Y-coordinate of the mouse.
   */
  getTooltip(
    state: State | null,
    trigger: HTMLElement,
    x: number,
    y: number,
  ) {
    let tip: string | null = null
    if (state != null) {
      // Checks if the mouse is over the folding icon
      if (
        state.control != null && (
          trigger === state.control.elem ||
          trigger.parentNode === state.control.elem
        )
      ) {
        tip = 'Collapse/Expand'
      }

      if (tip == null && state.overlays != null) {
        state.overlays.each((shape) => {
          if (tip == null &&
            (trigger === shape.elem || trigger.parentNode === shape.elem)
          ) {
            tip = shape.overlay!.toString()
          }
        })
      }

      if (tip == null) {
        const handler = this.graph.selectionHandler.getHandler(state.cell)
        const getTooltipForNode = handler && (handler as any).getTooltipForNode
        if (getTooltipForNode && typeof (getTooltipForNode) === 'function') {
          tip = getTooltipForNode(trigger)
        }
      }

      if (tip == null) {
        tip = this.graph.getTooltip(state.cell)
      }
    }

    return tip
  }

  /**
   * Returns the image URL for the given cell state.
   */
  getImage(state: State): string | null {
    return (state != null) && state.style.image || null
  }

  /**
   * Returns the vertical alignment for the given cell state.
   */
  getVerticalAlign(state: State): VAlign {
    return state && state.style.verticalAlign || 'middle'
  }

  getAlign(state: State): Align {
    return state && state.style.align || 'center'
  }

  /**
   * Returns the indicator color for the given cell state.
   */
  getIndicatorColor(state: State) {
    return state && state.style.indicatorColor || null
  }

  getIndicatorDirection(state: State) {
    return state && state.style.indicatorDirection || null
  }

  getIndicatorStrokeColor(state: State) {
    return state && state.style.indicatorStrokeColor || null
  }

  /**
   * Returns the indicator gradient color for the given cell state.
   */
  getIndicatorGradientColor(state: State) {
    return state && state.style.indicatorGradientColor || null
  }

  /**
   * Returns the indicator shape for the given cell state.
   */
  getIndicatorShape(state: State) {
    return state && state.style.indicatorShape || null
  }

  /**
   * Returns the indicator image for the given cell state.
   */
  getIndicatorImage(state: State) {
    return state && state.style.indicatorImage || null
  }

  // #endregion
}
