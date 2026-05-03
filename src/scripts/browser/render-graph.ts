import * as d3 from 'd3';

interface GraphNode {
  id: string;
  label: string;
  type: 'user' | 'organisation' | 'repository';
  cluster: string;
  weight: number;
}

interface GraphLink {
  source: string;
  target: string;
  weight: number;
}

interface GraphPayload {
  nodes: GraphNode[];
  links: GraphLink[];
}

const GRAPH_SELECTOR = '#contribution-graph';
const GRAPH_DATA_URL = new URL("data/graph.json", import.meta.env.BASE_URL).toString();

async function loadGraphPayload(url: string): Promise<GraphPayload> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load graph payload from ${url}: ${response.status} ${response.statusText}`);
  }

  const payload: unknown = await response.json();

  if (!isGraphPayload(payload)) {
    throw new Error(`Invalid graph payload loaded from ${url}.`);
  }

  return payload;
}

function isGraphPayload(value: unknown): value is GraphPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<GraphPayload>;

  return Array.isArray(candidate.nodes) && Array.isArray(candidate.links);
}

async function renderGraph(): Promise<void> {
  const container = document.querySelector<HTMLElement>(GRAPH_SELECTOR);

  if (!container) {
    throw new Error(`Graph container not found: ${GRAPH_SELECTOR}`);
  }

  const payload = await loadGraphPayload(GRAPH_DATA_URL);

  const width = container.clientWidth || 1200;
  const height = container.clientHeight || 800;

  container.replaceChildren();

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('role', 'img')
    .attr('aria-label', 'GitHub contribution graph');

  const simulation = d3
    .forceSimulation<GraphNode>(payload.nodes)
    .force(
      'link',
      d3
        .forceLink<GraphNode, GraphLink>(payload.links)
        .id((node) => node.id)
        .distance(120),
    )
    .force('charge', d3.forceManyBody().strength(-280))
    .force('center', d3.forceCenter(width / 2, height / 2));

  const links = svg
    .append('g')
    .selectAll('line')
    .data(payload.links)
    .join('line')
    .attr('stroke-width', (link) => Math.max(1, link.weight));

  const nodes = svg
    .append('g')
    .selectAll('circle')
    .data(payload.nodes)
    .join('circle')
    .attr('r', (node) => Math.max(6, Math.sqrt(node.weight) * 4))
    .call(
      d3
        .drag<SVGCircleElement, GraphNode>()
        .on('start', (event, node) => {
          if (!event.active) {
            simulation.alphaTarget(0.3).restart();
          }

          node.fx = node.x;
          node.fy = node.y;
        })
        .on('drag', (event, node) => {
          node.fx = event.x;
          node.fy = event.y;
        })
        .on('end', (event, node) => {
          if (!event.active) {
            simulation.alphaTarget(0);
          }

          node.fx = null;
          node.fy = null;
        }),
    );

  nodes.append('title').text((node) => `${node.label}: ${node.weight}`);

  simulation.on('tick', () => {
    links
      .attr('x1', (link) => getNodeX(link.source))
      .attr('y1', (link) => getNodeY(link.source))
      .attr('x2', (link) => getNodeX(link.target))
      .attr('y2', (link) => getNodeY(link.target));

    nodes.attr('cx', (node) => node.x ?? 0).attr('cy', (node) => node.y ?? 0);
  });
}

function getNodeX(node: string | GraphNode): number {
  return typeof node === 'string' ? 0 : node.x ?? 0;
}

function getNodeY(node: string | GraphNode): number {
  return typeof node === 'string' ? 0 : node.y ?? 0;
}

document.addEventListener('astro:page-load', () => {
  renderGraph().catch((error: unknown) => {
    console.error(error);
  });
});

renderGraph().catch((error: unknown) => {
  console.error(error);
});