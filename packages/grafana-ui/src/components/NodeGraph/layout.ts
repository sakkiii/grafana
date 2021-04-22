import { useEffect, useMemo, useState } from 'react';
import { forceSimulation, forceLink, forceCollide, forceX } from 'd3-force';
import { EdgeDatum, EdgeDatumLayout, NodeDatum } from './types';
import { Field } from '@grafana/data';
import { useNodeLimit } from './useNodeLimit';

export interface Config {
  linkDistance: number;
  linkStrength: number;
  forceX: number;
  forceXStrength: number;
  forceCollide: number;
  tick: number;
  gridLayout: boolean;
  sort?: {
    // Either a arc field or stats field
    field: Field;
    ascending: boolean;
  };
}

export const defaultConfig: Config = {
  linkDistance: 150,
  linkStrength: 0.5,
  forceX: 2000,
  forceXStrength: 0.02,
  forceCollide: 100,
  tick: 300,
  gridLayout: false,
};

/**
 * This will return copy of the nods and edges with x,y positions filled in. Also the layout changes source/target props
 * in edges from string ids to actual nodes.
 * TODO: the typing could probably be done better so it's clear that props are filled in after the layout
 */
export function useLayout(
  rawNodes: NodeDatum[],
  rawEdges: EdgeDatum[],
  config: Config = defaultConfig,
  nodeCountLimit: number,
  rootNodeId?: string
) {
  const [nodesGrid, setNodesGrid] = useState<NodeDatum[]>([]);
  const [edgesGrid, setEdgesGrid] = useState<EdgeDatumLayout[]>([]);

  const [nodesGraph, setNodesGraph] = useState<NodeDatum[]>([]);
  const [edgesGraph, setEdgesGraph] = useState<EdgeDatumLayout[]>([]);

  // TODO the use effect is probably not needed here right now, but may make sense later if we decide to move the layout
  // to webworker or just postpone until other things are rendered. Also right now it memoizes this for us.
  useEffect(() => {
    if (rawNodes.length === 0) {
      return;
    }

    // d3 just modifies the nodes directly, so lets make sure we don't leak that outside
    let rawNodesCopy = rawNodes.map((n) => ({ ...n }));
    let rawEdgesCopy = rawEdges.map((e) => ({ ...e }));

    defaultLayout(rawNodesCopy, rawEdgesCopy);

    setNodesGraph(rawNodesCopy);
    setEdgesGraph(rawEdgesCopy as EdgeDatumLayout[]);

    rawNodesCopy = rawNodes.map((n) => ({ ...n }));
    rawEdgesCopy = rawEdges.map((e) => ({ ...e }));
    gridLayout(rawNodesCopy, config.sort);

    setNodesGrid(rawNodesCopy);
    setEdgesGrid(rawEdgesCopy as EdgeDatumLayout[]);
  }, [config.sort, rawNodes, rawEdges]);

  const { nodes: nodesWithLimit, edges: edgesWithLimit, markers } = useNodeLimit(
    config.gridLayout ? nodesGrid : nodesGraph,
    config.gridLayout ? edgesGrid : edgesGraph,
    nodeCountLimit,
    config,
    rootNodeId
  );

  const bounds = useMemo(() => graphBounds([...nodesWithLimit, ...(markers || []).map((m) => m.node)]), [
    nodesWithLimit,
    markers,
  ]);

  return {
    nodes: nodesWithLimit,
    edges: edgesWithLimit,
    markers,
    bounds,
    hiddenNodesCount: rawNodes.length - nodesWithLimit.length,
  };
}

/**
 * Use d3 force layout to lay the nodes in a sensible way. This function modifies the nodes adding the x,y positions
 * and also fills in node references in edges instead of node ids.
 */
function defaultLayout(nodes: NodeDatum[], edges: EdgeDatum[], config: Config = defaultConfig) {
  // Start withs some hardcoded positions so it starts laid out from left to right
  let { roots, secondLevelRoots } = initializePositions(nodes, edges);

  // There always seems to be one or more root nodes each with single edge and we want to have them static on the
  // left neatly in something like grid layout
  [...roots, ...secondLevelRoots].forEach((n, index) => {
    n.fx = n.x;
  });

  const simulation = forceSimulation(nodes)
    .force(
      'link',
      forceLink(edges)
        .id((d: any) => d.id)
        .distance(config.linkDistance)
        .strength(config.linkStrength)
    )
    // to keep the left to right layout we add force that pulls all nodes to right but because roots are fixed it will
    // apply only to non root nodes
    .force('x', forceX(config.forceX).strength(config.forceXStrength))
    // Make sure nodes don't overlap
    .force('collide', forceCollide(config.forceCollide));

  // 300 ticks for the simulation are recommended but less would probably work too, most movement is done in first
  // few iterations and then all the forces gets smaller https://github.com/d3/d3-force#simulation_alphaDecay
  simulation.tick(config.tick);
  simulation.stop();

  // We do centering here instead of using centering force to keep this more stable
  centerNodes(nodes);
}

function gridLayout(
  nodes: NodeDatum[],
  sort?: {
    field: Field;
    ascending: boolean;
  }
  /* TODO for selecting the sort */
) {
  const spacingVertical = 140;
  const spacingHorizontal = 120;
  const perRow = 4;

  if (sort) {
    nodes.sort((node1, node2) => {
      const val1 = sort!.field.values.get(node1.dataFrameRowIndex);
      const val2 = sort!.field.values.get(node2.dataFrameRowIndex);

      // Lets pretend we don't care about type for a while
      return sort!.ascending ? val2 - val1 : val1 - val2;
    });
  }

  for (const [index, node] of nodes.entries()) {
    const row = Math.floor(index / perRow);
    const column = index % perRow;
    node.x = -180 + column * spacingHorizontal;
    node.y = -60 + row * spacingVertical;
  }
}

/**
 * This initializes positions of the graph by going from the root to it's children and laying it out in a grid from left
 * to right. This works only so, so because service map graphs can have cycles and children levels are not ordered in a
 * way to minimize the edge lengths. Nevertheless this seems to make the graph easier to nudge with the forces later on
 * than with the d3 default initial positioning. Also we can fix the root positions later on for a bit more neat
 * organisation.
 *
 * This function directly modifies the nodes given and only returns references to root nodes so they do not have to be
 * found again later on.
 *
 * How the spacing could look like approximately:
 * 0 - 0 - 0 - 0
 *  \- 0 - 0   |
 *      \- 0 -/
 * 0 - 0 -/
 */
function initializePositions(
  nodes: NodeDatum[],
  edges: EdgeDatum[]
): { roots: NodeDatum[]; secondLevelRoots: NodeDatum[] } {
  // To prevent going in cycles
  const alreadyPositioned: { [id: string]: boolean } = {};

  const nodesMap = nodes.reduce((acc, node) => ({ ...acc, [node.id]: node }), {} as Record<string, NodeDatum>);
  const edgesMap = edges.reduce((acc, edge) => {
    const sourceId = edge.source;
    return {
      ...acc,
      [sourceId]: [...(acc[sourceId] || []), edge],
    };
  }, {} as Record<string, EdgeDatum[]>);

  let roots = nodes.filter((n) => n.incoming === 0);

  // For things like service maps we assume there is some root (client) node but if there is none then selecting
  // any node as a starting point should work the same.
  if (!roots.length) {
    roots = [nodes[0]];
  }

  let secondLevelRoots = roots.reduce<NodeDatum[]>(
    (acc, r) => [...acc, ...(edgesMap[r.id] ? edgesMap[r.id].map((e) => nodesMap[e.target]) : [])],
    []
  );

  const rootYSpacing = 300;
  const nodeYSpacing = 200;
  const nodeXSpacing = 200;

  let rootY = 0;
  for (const root of roots) {
    let graphLevel = [root];
    let x = 0;
    while (graphLevel.length > 0) {
      const nextGraphLevel: NodeDatum[] = [];
      let y = rootY;
      for (const node of graphLevel) {
        if (alreadyPositioned[node.id]) {
          continue;
        }
        // Initialize positions based on the spacing in the grid
        node.x = x;
        node.y = y;
        alreadyPositioned[node.id] = true;

        // Move to next Y position for next node
        y += nodeYSpacing;
        if (edgesMap[node.id]) {
          nextGraphLevel.push(...edgesMap[node.id].map((edge) => nodesMap[edge.target]));
        }
      }

      graphLevel = nextGraphLevel;
      // Move to next X position for next level
      x += nodeXSpacing;
      // Reset Y back to baseline for this root
      y = rootY;
    }
    rootY += rootYSpacing;
  }
  return { roots, secondLevelRoots };
}

/**
 * Makes sure that the center of the graph based on it's bound is in 0, 0 coordinates.
 * Modifies the nodes directly.
 */
function centerNodes(nodes: NodeDatum[]) {
  const bounds = graphBounds(nodes);
  for (let node of nodes) {
    node.x = node.x! - bounds.center.x;
    node.y = node.y! - bounds.center.y;
  }
}

export interface Bounds {
  top: number;
  right: number;
  bottom: number;
  left: number;
  center: {
    x: number;
    y: number;
  };
}

/**
 * Get bounds of the graph meaning the extent of the nodes in all directions.
 */
export function graphBounds(nodes: NodeDatum[]): Bounds {
  if (nodes.length === 0) {
    return { top: 0, right: 0, bottom: 0, left: 0, center: { x: 0, y: 0 } };
  }

  const bounds = nodes.reduce(
    (acc, node) => {
      if (node.x! > acc.right) {
        acc.right = node.x!;
      }
      if (node.x! < acc.left) {
        acc.left = node.x!;
      }
      if (node.y! > acc.bottom) {
        acc.bottom = node.y!;
      }
      if (node.y! < acc.top) {
        acc.top = node.y!;
      }
      return acc;
    },
    { top: Infinity, right: -Infinity, bottom: -Infinity, left: Infinity }
  );

  const y = bounds.top + (bounds.bottom - bounds.top) / 2;
  const x = bounds.left + (bounds.right - bounds.left) / 2;

  return {
    ...bounds,
    center: {
      x,
      y,
    },
  };
}
