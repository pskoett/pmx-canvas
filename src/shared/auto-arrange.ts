export interface ArrangePosition {
  x: number;
  y: number;
}

export interface ArrangeSize {
  width: number;
  height: number;
}

export interface ArrangeNode {
  id: string;
  type: string;
  position: ArrangePosition;
  size: ArrangeSize;
  pinned: boolean;
  dockPosition: 'left' | 'right' | null;
  data: Record<string, unknown>;
}

export interface ArrangeEdge {
  id: string;
  from: string;
  to: string;
}

export interface AutoArrangeResult {
  nodePositions: Map<string, ArrangePosition>;
  groupBounds: Map<string, ArrangePosition & ArrangeSize>;
}

type ArrangeMode = 'grid' | 'graph';

interface ArrangeUnit {
  id: string;
  memberIds: string[];
  origin: ArrangePosition;
  size: ArrangeSize;
  sortKey: { x: number; y: number };
  groupId?: string;
}

interface ComponentLayout {
  positions: Map<string, ArrangePosition>;
  size: ArrangeSize;
  sortKey: { x: number; y: number };
}

const START_X = 40;
const START_Y = 80;
const UNIT_GAP_X = 96;
const UNIT_GAP_Y = 72;
const COMPONENT_GAP_X = 220;
const COMPONENT_GAP_Y = 180;
const MAX_ROW_WIDTH = 3200;
const GROUP_PAD = 40;
const GROUP_TITLEBAR_HEIGHT = 32;

function computeGroupBounds(rects: Array<{ position: ArrangePosition; size: ArrangeSize }>): (ArrangePosition & ArrangeSize) | null {
  if (rects.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rect of rects) {
    minX = Math.min(minX, rect.position.x);
    minY = Math.min(minY, rect.position.y);
    maxX = Math.max(maxX, rect.position.x + rect.size.width);
    maxY = Math.max(maxY, rect.position.y + rect.size.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  return {
    x: minX - GROUP_PAD,
    y: minY - GROUP_PAD - GROUP_TITLEBAR_HEIGHT,
    width: maxX - minX + GROUP_PAD * 2,
    height: maxY - minY + GROUP_PAD * 2 + GROUP_TITLEBAR_HEIGHT,
  };
}

function buildArrangeUnits(allNodes: ArrangeNode[]): {
  units: ArrangeUnit[];
  nodesById: Map<string, ArrangeNode>;
  nodeToUnit: Map<string, string>;
} {
  const movable = allNodes.filter((node) => !node.pinned && node.dockPosition === null);
  const nodesById = new Map(movable.map((node) => [node.id, node]));
  const nodeToUnit = new Map<string, string>();
  const units: ArrangeUnit[] = [];

  const groupChildren = new Map<string, ArrangeNode[]>();
  for (const node of movable) {
    if (node.type === 'group') continue;
    const parentGroupId = typeof node.data.parentGroup === 'string' ? node.data.parentGroup : '';
    const parent = parentGroupId ? nodesById.get(parentGroupId) : undefined;
    if (!parent || parent.type !== 'group') continue;
    if (!groupChildren.has(parentGroupId)) groupChildren.set(parentGroupId, []);
    groupChildren.get(parentGroupId)!.push(node);
  }

  const groups = movable
    .filter((node) => node.type === 'group')
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  for (const group of groups) {
    const children = groupChildren.get(group.id) ?? [];
    if (children.length === 0) {
      const unitId = `unit:${group.id}`;
      units.push({
        id: unitId,
        memberIds: [group.id],
        origin: { ...group.position },
        size: { ...group.size },
        sortKey: { x: group.position.x, y: group.position.y },
      });
      nodeToUnit.set(group.id, unitId);
      continue;
    }

    const childRects = children.map((child) => ({ position: child.position, size: child.size }));
    const bounds = computeGroupBounds(childRects);
    if (!bounds) continue;

    const unitId = `group:${group.id}`;
    units.push({
      id: unitId,
      memberIds: children.map((child) => child.id),
      origin: { x: bounds.x, y: bounds.y },
      size: { width: bounds.width, height: bounds.height },
      sortKey: { x: bounds.x, y: bounds.y },
      groupId: group.id,
    });
    nodeToUnit.set(group.id, unitId);
    for (const child of children) {
      nodeToUnit.set(child.id, unitId);
    }
  }

  const remaining = movable
    .filter((node) => !nodeToUnit.has(node.id))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  for (const node of remaining) {
    const unitId = `unit:${node.id}`;
    units.push({
      id: unitId,
      memberIds: [node.id],
      origin: { ...node.position },
      size: { ...node.size },
      sortKey: { x: node.position.x, y: node.position.y },
    });
    nodeToUnit.set(node.id, unitId);
  }

  return { units, nodesById, nodeToUnit };
}

function buildUnitGraphs(units: ArrangeUnit[], nodeToUnit: Map<string, string>, edges: ArrangeEdge[]): {
  outgoing: Map<string, Set<string>>;
  undirected: Map<string, Set<string>>;
  indegree: Map<string, number>;
  outdegree: Map<string, number>;
} {
  const outgoing = new Map<string, Set<string>>();
  const undirected = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  const outdegree = new Map<string, number>();

  for (const unit of units) {
    outgoing.set(unit.id, new Set());
    undirected.set(unit.id, new Set());
    indegree.set(unit.id, 0);
    outdegree.set(unit.id, 0);
  }

  for (const edge of edges) {
    const fromUnit = nodeToUnit.get(edge.from);
    const toUnit = nodeToUnit.get(edge.to);
    if (!fromUnit || !toUnit || fromUnit === toUnit) continue;

    if (!outgoing.get(fromUnit)!.has(toUnit)) {
      outgoing.get(fromUnit)!.add(toUnit);
      outdegree.set(fromUnit, (outdegree.get(fromUnit) ?? 0) + 1);
      indegree.set(toUnit, (indegree.get(toUnit) ?? 0) + 1);
    }
    undirected.get(fromUnit)!.add(toUnit);
    undirected.get(toUnit)!.add(fromUnit);
  }

  return { outgoing, undirected, indegree, outdegree };
}

function collectComponents(units: ArrangeUnit[], undirected: Map<string, Set<string>>): ArrangeUnit[][] {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const seen = new Set<string>();
  const components: ArrangeUnit[][] = [];

  for (const unit of units) {
    if (seen.has(unit.id)) continue;
    const stack = [unit.id];
    const componentIds: string[] = [];
    seen.add(unit.id);

    while (stack.length > 0) {
      const current = stack.pop()!;
      componentIds.push(current);
      for (const neighbor of undirected.get(current) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        stack.push(neighbor);
      }
    }

    const component = componentIds
      .map((id) => unitsById.get(id))
      .filter((entry): entry is ArrangeUnit => entry !== undefined)
      .sort((a, b) => a.sortKey.y - b.sortKey.y || a.sortKey.x - b.sortKey.x);
    components.push(component);
  }

  return components.sort((a, b) => a[0].sortKey.y - b[0].sortKey.y || a[0].sortKey.x - b[0].sortKey.x);
}

function computeGridComponent(component: ArrangeUnit[]): ComponentLayout {
  const positions = new Map<string, ArrangePosition>();
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let maxWidth = 0;
  const targetRowWidth = Math.max(
    900,
    Math.ceil(Math.sqrt(component.reduce((sum, unit) => sum + unit.size.width * unit.size.height, 0))),
  );

  for (const unit of component) {
    if (cursorX > 0 && cursorX + unit.size.width > targetRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + UNIT_GAP_Y;
      rowHeight = 0;
    }

    positions.set(unit.id, { x: cursorX, y: cursorY });
    cursorX += unit.size.width + UNIT_GAP_X;
    rowHeight = Math.max(rowHeight, unit.size.height);
    maxWidth = Math.max(maxWidth, cursorX - UNIT_GAP_X);
  }

  return {
    positions,
    size: {
      width: Math.max(0, maxWidth),
      height: cursorY + rowHeight,
    },
    sortKey: component[0].sortKey,
  };
}

function computeGraphComponent(
  component: ArrangeUnit[],
  outgoing: Map<string, Set<string>>,
  undirected: Map<string, Set<string>>,
  indegree: Map<string, number>,
  outdegree: Map<string, number>,
): ComponentLayout {
  if (component.length === 1) {
    return {
      positions: new Map([[component[0].id, { x: 0, y: 0 }]]),
      size: { ...component[0].size },
      sortKey: component[0].sortKey,
    };
  }

  const componentIds = new Set(component.map((unit) => unit.id));
  const roots = component
    .filter((unit) => (indegree.get(unit.id) ?? 0) === 0 && (outdegree.get(unit.id) ?? 0) > 0)
    .sort((a, b) => a.sortKey.x - b.sortKey.x || a.sortKey.y - b.sortKey.y);
  const seedUnits = roots.length > 0
    ? roots
    : [component.slice().sort((a, b) => a.sortKey.x - b.sortKey.x || a.sortKey.y - b.sortKey.y)[0]];

  const levels = new Map<string, number>();
  const queue = seedUnits.map((unit) => unit.id);
  for (const unit of seedUnits) levels.set(unit.id, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) ?? 0;
    for (const neighbor of undirected.get(current) ?? []) {
      if (!componentIds.has(neighbor) || levels.has(neighbor)) continue;
      levels.set(neighbor, currentLevel + 1);
      queue.push(neighbor);
    }
  }

  let fallbackLevel = 0;
  for (const unit of component) {
    if (levels.has(unit.id)) continue;
    levels.set(unit.id, fallbackLevel);
    fallbackLevel += 1;
  }

  const columns = new Map<number, ArrangeUnit[]>();
  for (const unit of component) {
    const level = levels.get(unit.id) ?? 0;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level)!.push(unit);
  }

  const orderedLevels = Array.from(columns.keys()).sort((a, b) => a - b);
  for (const level of orderedLevels) {
    columns.get(level)!.sort((a, b) => a.sortKey.y - b.sortKey.y || a.sortKey.x - b.sortKey.x);
  }

  const columnHeights = new Map<number, number>();
  const columnWidths = new Map<number, number>();
  let maxHeight = 0;
  for (const level of orderedLevels) {
    const levelUnits = columns.get(level)!;
    const height = levelUnits.reduce((sum, unit, index) => sum + unit.size.height + (index > 0 ? UNIT_GAP_Y : 0), 0);
    const width = Math.max(...levelUnits.map((unit) => unit.size.width));
    columnHeights.set(level, height);
    columnWidths.set(level, width);
    maxHeight = Math.max(maxHeight, height);
  }

  const positions = new Map<string, ArrangePosition>();
  let cursorX = 0;
  for (const level of orderedLevels) {
    const levelUnits = columns.get(level)!;
    const columnHeight = columnHeights.get(level) ?? 0;
    const columnWidth = columnWidths.get(level) ?? 0;
    let cursorY = Math.max(0, (maxHeight - columnHeight) / 2);

    for (const unit of levelUnits) {
      positions.set(unit.id, {
        x: cursorX,
        y: cursorY,
      });
      cursorY += unit.size.height + UNIT_GAP_Y;
    }

    cursorX += columnWidth + UNIT_GAP_X;
  }

  return {
    positions,
    size: {
      width: Math.max(0, cursorX - UNIT_GAP_X),
      height: maxHeight,
    },
    sortKey: component[0].sortKey,
  };
}

function placeComponents(components: ComponentLayout[]): Map<string, ArrangePosition> {
  const absolute = new Map<string, ArrangePosition>();
  let cursorX = START_X;
  let cursorY = START_Y;
  let rowHeight = 0;

  for (const component of components) {
    if (cursorX > START_X && cursorX + component.size.width > MAX_ROW_WIDTH) {
      cursorX = START_X;
      cursorY += rowHeight + COMPONENT_GAP_Y;
      rowHeight = 0;
    }

    for (const [unitId, position] of component.positions.entries()) {
      absolute.set(unitId, {
        x: cursorX + position.x,
        y: cursorY + position.y,
      });
    }

    cursorX += component.size.width + COMPONENT_GAP_X;
    rowHeight = Math.max(rowHeight, component.size.height);
  }

  return absolute;
}

export function computeAutoArrange(
  allNodes: ArrangeNode[],
  allEdges: ArrangeEdge[],
  mode: ArrangeMode,
): AutoArrangeResult {
  const { units, nodesById, nodeToUnit } = buildArrangeUnits(allNodes);
  const nodePositions = new Map<string, ArrangePosition>();
  const groupBounds = new Map<string, ArrangePosition & ArrangeSize>();

  if (units.length === 0) {
    return { nodePositions, groupBounds };
  }

  const { outgoing, undirected, indegree, outdegree } = buildUnitGraphs(units, nodeToUnit, allEdges);
  const components = collectComponents(units, undirected).map((component) =>
    mode === 'graph'
      ? computeGraphComponent(component, outgoing, undirected, indegree, outdegree)
      : computeGridComponent(component),
  );
  const absoluteUnitPositions = placeComponents(components);

  for (const unit of units) {
    const targetOrigin = absoluteUnitPositions.get(unit.id);
    if (!targetOrigin) continue;
    const deltaX = targetOrigin.x - unit.origin.x;
    const deltaY = targetOrigin.y - unit.origin.y;

    if (unit.groupId) {
      const translatedRects: Array<{ position: ArrangePosition; size: ArrangeSize }> = [];
      for (const memberId of unit.memberIds) {
        const node = nodesById.get(memberId);
        if (!node) continue;
        const position = {
          x: node.position.x + deltaX,
          y: node.position.y + deltaY,
        };
        nodePositions.set(memberId, position);
        translatedRects.push({ position, size: node.size });
      }
      const bounds = computeGroupBounds(translatedRects);
      if (bounds) groupBounds.set(unit.groupId, bounds);
      continue;
    }

    const nodeId = unit.memberIds[0];
    const node = nodesById.get(nodeId);
    if (!node) continue;
    nodePositions.set(nodeId, {
      x: node.position.x + deltaX,
      y: node.position.y + deltaY,
    });
  }

  return { nodePositions, groupBounds };
}
