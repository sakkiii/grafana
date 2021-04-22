import React, { memo, MouseEvent, MutableRefObject, useCallback, useMemo, useState } from 'react';
import cx from 'classnames';
import useMeasure from 'react-use/lib/useMeasure';
import { usePanning } from './usePanning';
import { EdgeDatum, NodeDatum, NodesMarker } from './types';
import { Node } from './Node';
import { Edge } from './Edge';
import { ViewControls } from './ViewControls';
import { DataFrame, GrafanaTheme, LinkModel } from '@grafana/data';
import { useZoom } from './useZoom';
import { Bounds, Config, defaultConfig, useLayout } from './layout';
import { EdgeArrowMarker } from './EdgeArrowMarker';
import { stylesFactory, useTheme } from '../../themes';
import { css } from '@emotion/css';
import { useCategorizeFrames } from './useCategorizeFrames';
import { EdgeLabel } from './EdgeLabel';
import { useContextMenu } from './useContextMenu';
import { processNodes } from './utils';
import { Icon } from '..';
import { Marker } from './Marker';
import { Legend } from './Legend';
import { useHighlight } from './useHighlight';
import { usePrevious } from 'react-use';

const getStyles = stylesFactory((theme: GrafanaTheme) => ({
  wrapper: css`
    height: 100%;
    width: 100%;
    overflow: hidden;
    position: relative;
  `,

  svg: css`
    height: 100%;
    width: 100%;
    overflow: visible;
    font-size: 10px;
    cursor: move;
  `,

  svgPanning: css`
    user-select: none;
  `,

  mainGroup: css`
    will-change: transform;
  `,

  viewControls: css`
    position: absolute;
    left: 2px;
    bottom: 3px;
    right: 0;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  `,
  legend: css`
    background: ${theme.v2.palette.background.secondary};
    box-shadow: ${theme.v2.shadows.z2};
    padding-bottom: 5px;
  `,
  alert: css`
    padding: 5px 8px;
    font-size: 10px;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
    border-radius: ${theme.border.radius.md};
    align-items: center;
    position: absolute;
    top: 0;
    right: 0;
    background: ${theme.palette.warn};
    color: ${theme.palette.white};
  `,
}));

// This is mainly for performance reasons.
const defaultNodeCountLimit = 7;

interface Props {
  dataFrames: DataFrame[];
  getLinks: (dataFrame: DataFrame, rowIndex: number) => LinkModel[];
  nodeLimit?: number;
}
export function NodeGraph({ getLinks, dataFrames, nodeLimit }: Props) {
  const nodeCountLimit = nodeLimit || defaultNodeCountLimit;
  const { edges: edgesDataFrames, nodes: nodesDataFrames } = useCategorizeFrames(dataFrames);

  const [measureRef, { width, height }] = useMeasure();
  const [config, setConfig] = useState<Config>(defaultConfig);

  // We need hover state here because for nodes we also highlight edges and for edges have labels separate to make
  // sure they are visible on top of everything else
  const { nodeHover, setNodeHover, clearNodeHover, edgeHover, setEdgeHover, clearEdgeHover } = useHover();

  const firstNodesDataFrame = nodesDataFrames[0];
  const firstEdgesDataFrame = edgesDataFrames[0];

  const theme = useTheme();

  // TODO we should be able to allow multiple dataframes for both edges and nodes, could be issue with node ids which in
  //  that case should be unique or figure a way to link edges and nodes dataframes together.
  const processed = useMemo(() => processNodes(firstNodesDataFrame, firstEdgesDataFrame, theme), [
    firstEdgesDataFrame,
    firstNodesDataFrame,
    theme,
  ]);

  const [focusedNodeId, setFocusedNodeId] = useState<string>();

  // May seem weird that we do layout first and then limit the nodes shown but the problem is we want to keep the node
  // position stable which means we need the full layout first and then just visually hide the nodes. As hiding/showing
  // nodes should not have effect on layout it should not be recalculated.
  const { nodes, edges, markers, bounds, hiddenNodesCount } = useLayout(
    processed.nodes,
    processed.edges,
    config,
    nodeCountLimit,
    focusedNodeId
  );

  const prevLayoutGrid = usePrevious(config.gridLayout);
  let focusPosition;
  if (prevLayoutGrid === true && !config.gridLayout && focusedNodeId) {
    const node = nodes.find((n) => n.id === focusedNodeId);
    if (node) {
      focusPosition = {
        x: -node.x!,
        y: -node.y!,
      };
    }
  }
  const { panRef, zoomRef, onStepUp, onStepDown, isPanning, position, scale, isMaxZoom, isMinZoom } = usePanAndZoom(
    bounds,
    focusPosition
  );

  const { onEdgeOpen, onNodeOpen, MenuComponent } = useContextMenu(
    getLinks,
    nodesDataFrames[0],
    edgesDataFrames[0],
    config.gridLayout
      ? {
          nodes: [
            {
              label: 'Show in Graph layout',
              onClick: (node) => {
                setFocusedNodeId(node.id);
                setConfig({ ...config, gridLayout: false });
              },
            },
          ],
        }
      : undefined
  );
  const styles = getStyles(theme);

  // This cannot be inline func or it will create infinite render cycle.
  const topLevelRef = useCallback(
    (r) => {
      measureRef(r);
      (zoomRef as MutableRefObject<HTMLElement | null>).current = r;
    },
    [measureRef, zoomRef]
  );

  const highlightId = useHighlight(focusedNodeId);

  return (
    <div ref={topLevelRef} className={styles.wrapper}>
      <svg
        ref={panRef}
        viewBox={`${-(width / 2)} ${-(height / 2)} ${width} ${height}`}
        className={cx(styles.svg, isPanning && styles.svgPanning)}
      >
        <g
          className={styles.mainGroup}
          style={{ transform: `scale(${scale}) translate(${Math.floor(position.x)}px, ${Math.floor(position.y)}px)` }}
        >
          <EdgeArrowMarker />
          {!config.gridLayout && (
            <Edges
              edges={edges}
              nodeHoveringId={nodeHover}
              edgeHoveringId={edgeHover}
              onClick={onEdgeOpen}
              onMouseEnter={setEdgeHover}
              onMouseLeave={clearEdgeHover}
            />
          )}
          <Nodes
            nodes={nodes}
            onMouseEnter={setNodeHover}
            onMouseLeave={clearNodeHover}
            onClick={onNodeOpen}
            hoveringId={nodeHover || highlightId}
          />

          <Markers markers={markers || []} onClick={(e, m) => setFocusedNodeId(m.node.id)} />
          {/*We split the labels from edges so that they are shown on top of everything else*/}
          {!config.gridLayout && <EdgeLabels edges={edges} nodeHoveringId={nodeHover} edgeHoveringId={edgeHover} />}
        </g>
      </svg>

      <div className={styles.viewControls}>
        {nodes.length && (
          <div className={styles.legend}>
            <Legend
              sortable={config.gridLayout}
              nodes={nodes}
              sort={config.sort}
              onSort={(sort) => {
                setConfig({
                  ...config,
                  sort: sort,
                });
              }}
            />
          </div>
        )}

        <ViewControls<Config>
          config={config}
          onConfigChange={(cfg) => {
            if (cfg.gridLayout !== config.gridLayout) {
              setFocusedNodeId(undefined);
            }
            setConfig(cfg);
          }}
          onMinus={onStepDown}
          onPlus={onStepUp}
          scale={scale}
          disableZoomIn={isMaxZoom}
          disableZoomOut={isMinZoom}
        />
      </div>

      {hiddenNodesCount > 0 && (
        <div className={styles.alert} aria-label={'Nodes hidden warning'}>
          <Icon size="sm" name={'info-circle'} /> {hiddenNodesCount} nodes are hidden for performance reasons.
        </div>
      )}

      {MenuComponent}
    </div>
  );
}

// These components are here as a perf optimisation to prevent going through all nodes and edges on every pan/zoom.

interface NodesProps {
  nodes: NodeDatum[];
  onMouseEnter: (id: string) => void;
  onMouseLeave: (id: string) => void;
  onClick: (event: MouseEvent<SVGElement>, node: NodeDatum) => void;
  hoveringId?: string;
}
const Nodes = memo(function Nodes(props: NodesProps) {
  return (
    <>
      {props.nodes.map((n) => (
        <Node
          key={n.id}
          node={n}
          onMouseEnter={props.onMouseEnter}
          onMouseLeave={props.onMouseLeave}
          onClick={props.onClick}
          hovering={props.hoveringId === n.id}
        />
      ))}
    </>
  );
});

interface MarkersProps {
  markers: NodesMarker[];
  onClick: (event: MouseEvent<SVGElement>, marker: NodesMarker) => void;
}
const Markers = memo(function Nodes(props: MarkersProps) {
  return (
    <>
      {props.markers.map((m) => (
        <Marker key={'marker-' + m.node.id} marker={m} onClick={props.onClick} />
      ))}
    </>
  );
});

interface EdgesProps {
  edges: EdgeDatum[];
  nodeHoveringId?: string;
  edgeHoveringId?: string;
  onClick: (event: MouseEvent<SVGElement>, link: EdgeDatum) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: (id: string) => void;
}
const Edges = memo(function Edges(props: EdgesProps) {
  return (
    <>
      {props.edges.map((e) => (
        <Edge
          key={e.id}
          edge={e}
          hovering={
            (e.source as NodeDatum).id === props.nodeHoveringId ||
            (e.target as NodeDatum).id === props.nodeHoveringId ||
            props.edgeHoveringId === e.id
          }
          onClick={props.onClick}
          onMouseEnter={props.onMouseEnter}
          onMouseLeave={props.onMouseLeave}
        />
      ))}
    </>
  );
});

interface EdgeLabelsProps {
  edges: EdgeDatum[];
  nodeHoveringId?: string;
  edgeHoveringId?: string;
}
const EdgeLabels = memo(function EdgeLabels(props: EdgeLabelsProps) {
  return (
    <>
      {props.edges.map((e, index) => {
        const shouldShow =
          (e.source as NodeDatum).id === props.nodeHoveringId ||
          (e.target as NodeDatum).id === props.nodeHoveringId ||
          props.edgeHoveringId === e.id;
        const hasStats = e.mainStat || e.secondaryStat;
        return shouldShow && hasStats && <EdgeLabel key={e.id} edge={e} />;
      })}
    </>
  );
});

function usePanAndZoom(bounds: Bounds, focus?: { x: number; y: number }) {
  const { scale, onStepDown, onStepUp, ref, isMax, isMin } = useZoom();
  const { state: panningState, ref: panRef } = usePanning<SVGSVGElement>({
    scale,
    bounds,
    focus,
  });
  const { position, isPanning } = panningState;
  return { zoomRef: ref, panRef, position, isPanning, scale, onStepDown, onStepUp, isMaxZoom: isMax, isMinZoom: isMin };
}

function useHover() {
  const [nodeHover, setNodeHover] = useState<string | undefined>(undefined);
  const clearNodeHover = useCallback(() => setNodeHover(undefined), [setNodeHover]);
  const [edgeHover, setEdgeHover] = useState<string | undefined>(undefined);
  const clearEdgeHover = useCallback(() => setEdgeHover(undefined), [setEdgeHover]);

  return { nodeHover, setNodeHover, clearNodeHover, edgeHover, setEdgeHover, clearEdgeHover };
}
