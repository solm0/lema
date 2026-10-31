import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import * as d3 from "d3";
import type { TreeNode } from "../../types";
import { IconButton } from "../util/Button";
import { Focus } from "lucide-react";
import PruneIcon from "../svgs/PruneIcon";
import PurgeIcon from "../svgs/PurgeIcon";
import { useI18n } from "../../i18n";

function findInData(node: TreeNode, lemma: string): TreeNode | null {
  if (node.lemma === lemma) return node;
  for (const child of node.children ?? []) {
    const found = findInData(child, lemma);
    if (found) return found;
  }
  return null;
}

// ── 스타일 변수 ──────────────────────────────────────────────────────────────
const STYLE = {
  font:                "'Pretendard', sans-serif",
  fontSize:            "16px",
  fontWeight:          "450",

  circleRInner:        4.5,
  circleColorInternal: "var(--color-neutral-600)",
  circleColorLeaf:     "var(--color-accent)",

  textColor:           "var(--color-neutral-600)",
  textHaloColor:       "var(--color-neutral-100)",
  textHaloWidth:       3,

  linkColor:           "var(--color-neutral-300)",
  linkWidth:           1,

  duration:            280,
  depthSpacing:        180,
};

const MARGIN = { top: 40, right: 80, bottom: 40, left: 80 };

// ── 데이터 ───────────────────────────────────────────────────────────────────
export type D3Node = d3.HierarchyPointNode<TreeNode> & {
  x0?: number;
  y0?: number;
};

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────
type BreadcrumbProps = {
  initialLemmaKey: string;
  activeNode: D3Node | null;
  setActiveNode: (n: D3Node | null) => void;
  nodeStatusByLemma?: Record<string, "loading" | "ready">;
};

const Breadcrumb = forwardRef<
  { addNode: (parentLemma: string, newNode: TreeNode) => void },
  BreadcrumbProps
>(function Breadcrumb(
  { initialLemmaKey, activeNode, setActiveNode, nodeStatusByLemma = {} },
  ref
) {
  const { t } = useI18n();
  const rootRef = useRef<D3Node | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);

  const activeNodeRef = useRef<D3Node | null>(null);
  const updateRef = useRef<((source: D3Node) => void) | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const nodeStatusRef = useRef<Record<string, "loading" | "ready">>({});

  const setActive = useCallback((node: D3Node | null) => {
    activeNodeRef.current = node;
    setActiveNode(node);
    if (updateRef.current) {
      updateRef.current(node ?? ({} as D3Node));
    }
  }, []);

  useEffect(() => {
    if (rootRef.current) {
      setActive(rootRef.current);
    }
  }, []);

  // -- 컨트롤 ─────────────────────────────────────────────────────────────────
  const handleGotoBase = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    setActive(root);

    const svgEl = svgRef.current;
    if (svgEl && zoomRef.current) {
      d3.select(svgEl)
        .transition()
        .duration(400)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(MARGIN.left, MARGIN.top).scale(0.8)
        );
    }
  }, [setActive]);

  const handlePrune = useCallback(() => {
    const root = rootRef.current;
    if (!root || !activeNodeRef.current) return;

    // activeNode의 조상 lemma 집합 (activeNode 포함)
    const activeAncestorLemmas = new Set(
      activeNodeRef.current
        ? (activeNodeRef.current.ancestors() as D3Node[]).map((n) => n.data.lemma)
        : ["base"]
    );

    // 재귀적으로 조상 경로에 없는 자식들을 제거
    function pruneNode(data: TreeNode): TreeNode {
      if (!data.children) return data;
      const kept = data.children
        .filter((c) => activeAncestorLemmas.has(c.lemma))
        .map(pruneNode);
      data.children = kept.length > 0 ? kept : undefined;
      return data;
    }

    pruneNode(root.data);
    updateRef.current?.(root);
  }, []);

  const handlePurge = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    root.data.children = undefined;

    // activeNode가 base가 아니었으면 base로
    setActive(root);
    updateRef.current?.(root);
  }, [setActive]);

  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    nodeStatusRef.current = nodeStatusByLemma;
    if (updateRef.current) {
      updateRef.current(activeNodeRef.current ?? ({} as D3Node));
    }
  }, [nodeStatusByLemma]);

  useEffect(() => {
    let root = d3.hierarchy({ lemma: initialLemmaKey }) as D3Node;
      root.x0 = 0;
      root.y0 = 0;
      rootRef.current = root;
    
    const el        = svgRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    const svg = d3.select(el);
    svg.selectAll("*").remove();

    // ── zoom / pan 설정 ────────────────────────────────────────────────────
  //   svg.append("defs").html(`
  //   <pattern id="dotgrid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
  //     <line x1="12" y1="0" x2="12" y2="24" stroke=${STYLE.gridColor} stroke-width="1"/>
  //     <line x1="0" y1="12" x2="24" y2="12" stroke=${STYLE.gridColor} stroke-width="1"/>
  //   </pattern>
  // `);

    const zoomG = svg.append("g").attr("class", "zoom-layer");

    svg.insert("rect", ":first-child")
      .attr("id", "dot-bg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("fill", "url(#dotgrid)");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 3])
      .on("zoom", (event) => {
        zoomG.attr("transform", event.transform);
        svg.select("#dotgrid")
          .attr("patternTransform", event.transform.toString());
      });
    zoomRef.current = zoom;

    svg
      .call(zoom)
      .on("dblclick.zoom", () => {
        svg.transition().duration(400)
          .call(zoom.transform, d3.zoomIdentity)
          .on("end", () => {
            svg.select("#dotgrid").attr("patternTransform", null);
          });
      });

    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(MARGIN.left, MARGIN.top).scale(0.8)
    );

    const g         = zoomG.append("g");
    const linkGroup = g.append("g").attr("fill", "none");
    const nodeGroup = g.append("g");

    const treeLayout = d3.tree<TreeNode>().nodeSize([36, STYLE.depthSpacing]);

    let uid = 0;

    function diagonal(s: { x: number; y: number }, t: { x: number; y: number }) {
      return `M ${s.y} ${s.x}
              C ${(s.y + t.y) / 2} ${s.x},
                ${(s.y + t.y) / 2} ${t.x},
                ${t.y} ${t.x}`;
    }

    function isInternal(d: D3Node) {
      return !!d.children;
    }

    function getStatus(d: D3Node) {
      return nodeStatusRef.current[d.data.lemma];
    }

    function getActivePath(active: D3Node | null): Set<string> {
      if (!active) return new Set();
      const ids = new Set<string>();
      (active.ancestors() as D3Node[]).forEach((n) => {
        if (n.id) ids.add(n.id as unknown as string);
      });
      return ids;
    }

    function applyOpacity(
      nodeSelection: d3.Selection<SVGGElement, D3Node, SVGGElement, unknown>,
      linkSelection: d3.Selection<SVGPathElement, d3.HierarchyLink<TreeNode>, SVGGElement, unknown>,
      activeIds: Set<string>,
      hoveredId: string | null
    ) {
      const hasActive = activeIds.size > 0;

      nodeSelection.style("opacity", (d) => {
        if (!hasActive) return "1";
        const id = d.id as unknown as string;
        if (id === hoveredId) return "1";
        return activeIds.has(id) ? "1" : "0.5";
      });

      linkSelection.style("opacity", (d) => {
        if (!hasActive) return "1";
        const sourceId = (d.source as D3Node).id as unknown as string;
        const targetId = (d.target as D3Node).id as unknown as string;
        return activeIds.has(sourceId) && activeIds.has(targetId) ? "1" : "0.4";
      });
    }

    const BTN_W = 20, BTN_H = 20;

    const fo = nodeGroup.append("foreignObject")
      .attr("width", BTN_W)
      .attr("height", BTN_H)
      .attr("x", 0).attr("y", 0)
      .style("display", "none")
      .style("pointer-events", "all");

    let hoveredId: string | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleHide() {
      hideTimer = setTimeout(() => {
        fo.style("display", "none");
      }, 150);
    }

    fo.on("mouseenter", () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }).on("mouseleave", scheduleHide);

    // ── update ────────────────────────────────────────────────────────────
    function update(source: D3Node) {

      // data가 변경된 경우(추가/삭제) hierarchy를 완전히 재구성
      const rebuilt = d3.hierarchy(rootRef.current!.data) as D3Node;
      
      // 기존 노드의 x0/y0/id를 lemma 기준으로 이식
      const posMap = new Map<string, { x: number; y: number; id: any }>();
      (rootRef.current as d3.HierarchyNode<TreeNode>).descendants().forEach((d: any) => {
        if (d.data.lemma) posMap.set(d.data.lemma, { x: d.x ?? 0, y: d.y ?? 0, id: d.id });
      });
      rebuilt.each((d: D3Node) => {
        const pos = posMap.get(d.data.lemma);
        d.x0 = pos?.x ?? 0;
        d.y0 = pos?.y ?? 0;
        if (pos?.id) (d as any).id = pos.id;
      });
      
      // root 자체를 rebuilt로 교체 (Object.assign 대신 rootRef 갱신)
      rootRef.current = rebuilt;
      const root = rebuilt; // 이하 코드에서 root 참조 교체
      
      // activeNode를 새 hierarchy에서 찾아 교체
      if (activeNodeRef.current) {
        const newActive = rebuilt.descendants()
          .find(d => d.id === activeNodeRef.current!.id) as D3Node | undefined;
        activeNodeRef.current = newActive ?? null;
      }

      treeLayout(rebuilt);
      const nodes = rebuilt.descendants() as D3Node[];
      const links = (root as d3.HierarchyNode<TreeNode>).links();

      nodes.forEach((d) => { d.y = d.depth * STYLE.depthSpacing; });

      svg
        .attr("width",  container!.clientWidth)
        .attr("height", container!.clientHeight);

      // 링크
      const link = linkGroup
        .selectAll<SVGPathElement, d3.HierarchyLink<TreeNode>>("path.link")
        .data(links, (d) => (d.target as D3Node).id as unknown as string);

      const linkEnter = link.enter().append("path")
        .attr("class", "link")
        .attr("stroke", STYLE.linkColor)
        .attr("stroke-width", STYLE.linkWidth)
        .attr("d", () => {
          const o = { x: source.x0 ?? 0, y: source.y0 ?? 0 };
          return diagonal(o, o);
        });

      link.merge(linkEnter).transition().duration(STYLE.duration)
        .attr("d", (d) =>
          diagonal(
            { x: (d.source as D3Node).x ?? 0, y: (d.source as D3Node).y ?? 0 },
            { x: (d.target as D3Node).x ?? 0, y: (d.target as D3Node).y ?? 0 }
          )
        );

      link.exit().transition().duration(STYLE.duration)
        .attr("d", () => {
          const o = { x: source.x ?? 0, y: source.y ?? 0 };
          return diagonal(o, o);
        })
        .remove();

      // 노드
      const node = nodeGroup
        .selectAll<SVGGElement, D3Node>("g.node")
        .data(nodes, (d) => {
          if (!d.id) (d as any).id = ++uid as unknown as string;
          return d.id as unknown as string;
        });

      const nodeEnter = node.enter().append("g")
        .attr("class", "node")
        .attr("transform", `translate(${source.y0 ?? 0},${source.x0 ?? 0})`)
        .style("cursor", "pointer");

      nodeEnter.append("circle")
        .attr("r", STYLE.circleRInner)
        .attr("fill", (d) => isInternal(d) ? STYLE.circleColorInternal : STYLE.circleColorLeaf);

      nodeEnter.append("text")
        .attr("dy", "0.2em")
        .attr("text-anchor", (d) => (isInternal(d) ? "end" : "start"))
        .style("font-family", STYLE.font)
        .style("font-size", STYLE.fontSize)
        .style("font-weight", STYLE.fontWeight)
        .attr("stroke", STYLE.textHaloColor)
        .attr("stroke-width", STYLE.textHaloWidth)
        .attr("paint-order", "stroke")
        .attr("fill", STYLE.textColor)
        .text((d) => d.data.lemma.split('_')[0]);

      const statusGroup = nodeEnter.append("g")
        .attr("class", "status")
        .attr("transform", "translate(12,-12)")
        .style("pointer-events", "none")
        .style("display", "none");

      const spinner = statusGroup.append("g").attr("class", "status-spinner");
      spinner.append("circle")
        .attr("r", 6)
        .attr("cx", 0)
        .attr("cy", 0)
        .attr("fill", "none")
        .attr("stroke", "var(color--neutral-600")
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round")
        .attr("stroke-dasharray", "10 6");
      spinner.append("animateTransform")
        .attr("attributeName", "transform")
        .attr("type", "rotate")
        .attr("from", "0 0 0")
        .attr("to", "360 0 0")
        .attr("dur", "0.9s")
        .attr("repeatCount", "indefinite");

      const check = statusGroup.append("g").attr("class", "status-check");
      check.append("circle")
        .attr("r", 6)
        .attr("cx", 0)
        .attr("cy", 0)
        .attr("fill", "var(color--neutral-200")
      check.append("path")
        .attr("d", "M -3 0 L -1 3 L 4 -3")
        .attr("fill", "none")
        .attr("stroke", "var(color--neutral-600")
        .attr("stroke-width", 1.5)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round");

      const nodeUpdate = node.merge(nodeEnter);

      nodeUpdate.transition().duration(STYLE.duration)
        .attr("transform", (d) => `translate(${d.y ?? 0},${d.x ?? 0})`);

      nodeUpdate.select("circle")
        .attr("fill", (d) => isInternal(d) ? STYLE.circleColorInternal : STYLE.circleColorLeaf);

      nodeUpdate.select("text")
        .attr("x", (d) => (isInternal(d) ? -10 : 10))
        .attr("text-anchor", (d) => (isInternal(d) ? "end" : "start"));

      nodeUpdate
        .style("cursor", (d) => getStatus(d) === "loading" ? "progress" : "pointer")
        .on("click", (_event, d) => {
          if (getStatus(d) === "loading") return;
        fo.style("display", "none");
        hoveredId = null;
        setActive(d);
      });

      node.exit().transition().duration(STYLE.duration)
        .attr("transform", `translate(${source.y ?? 0},${source.x ?? 0})`)
        .style("opacity", 0)
        .remove();

      nodeGroup.node()?.appendChild(fo.node()!);

      const activeIds = getActivePath(activeNodeRef.current);
      const allNodes  = nodeGroup.selectAll<SVGGElement, D3Node>("g.node");
      const allLinks  = linkGroup.selectAll<SVGPathElement, d3.HierarchyLink<TreeNode>>("path.link");
      applyOpacity(allNodes, allLinks, activeIds, hoveredId);

      nodeGroup.selectAll<SVGGElement, D3Node>("g.node").select("g.status")
        .style("display", (d) => getStatus(d) ? null : "none")
        .select("g.status-spinner")
        .style("display", (d) => getStatus(d) === "loading" ? null : "none");

      nodeGroup.selectAll<SVGGElement, D3Node>("g.node").select("g.status")
        .select("g.status-check")
        .style("display", (d) => getStatus(d) === "ready" ? null : "none");

      nodes.forEach((d) => { d.x0 = d.x; d.y0 = d.y; });
    }

    updateRef.current = update;

    update(root);

    const ro = new ResizeObserver(() => {
      svg
        .attr("width",  container.clientWidth)
        .attr("height", container.clientHeight);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [setActive]);

  useImperativeHandle(ref, () => ({
    addNode: (parentLemma: string, newNode: TreeNode) => {
      const root = rootRef.current;
      if (!root) return;

      // 전체 그래프에서 같은 lemma가 있는지 먼저 확인
      const existing = (root as d3.HierarchyNode<TreeNode>)
        .descendants()
        .find(d => d.data.lemma === newNode.lemma);

      if (existing) {
        setActive(existing as D3Node);
        return;
      }

      const targetData = findInData(root.data, parentLemma);
      if (!targetData) return;
      targetData.children = [...(targetData.children ?? []), newNode];

      updateRef.current?.(root);

      const newTarget = rootRef.current!
        .descendants()
        .find(d => d.data.lemma === newNode.lemma && d.parent?.data.lemma === parentLemma);
      if (newTarget) setActive(newTarget as D3Node);

      // update 후 새 노드 위치로 이동
      setTimeout(() => {
        const newTarget = rootRef.current!
          .descendants()
          .find(d => d.data.lemma === newNode.lemma && d.parent?.data.lemma === parentLemma) as D3Node | undefined;

        if (newTarget && svgRef.current && zoomRef.current) {
          const svgEl = svgRef.current;
          const container = containerRef.current;
          if (!container) return;

          const currentTransform = d3.zoomTransform(svgEl);
          const targetX = -(newTarget.y ?? 0) * currentTransform.k + container.clientWidth / 2;
          const targetY = -(newTarget.x ?? 0) * currentTransform.k + container.clientHeight / 2;

          d3.select(svgEl)
            .transition()
            .duration(400)
            .call(
              zoomRef.current.transform,
              d3.zoomIdentity
                .translate(targetX, targetY)
                .scale(currentTransform.k)  // 현재 줌 레벨 유지
            );
        }
      }, 50); // layout 계산 후 실행
    }
  }));

  useEffect(() => {
    if (updateRef.current) {
      updateRef.current(activeNodeRef.current ?? ({} as D3Node));
    }
  }, [activeNode]);

  return (
    <div
      ref={containerRef}
      data-no-drag="true"
      data-side-layout-no-swipe="true"
      className="shrink-0 relative w-full h-22 md:h-26 border-b border-neutral-200 cursor-grab overflow-hidden group md:mt-10 md:border-t md:border-b-0 md:border-neutral-200"
    >
      <svg
        ref={svgRef}
        data-no-drag="true"
        style={{ display: "block", width: "100%", height: "100%" }}
      />

      {/* 컨트롤 */}
      <div className={`absolute right-1 bottom-1 h-auto w-auto flex gap-1 text-sm md:text-xs opacity-0 group-hover:opacity-100 transition-opacity text-neutral-400`}>
        <IconButton icon={<Focus size={16}/>} onClick={handleGotoBase} title={t("Go to base")}/>
        <IconButton icon={<PruneIcon className="w-3.5 h-3" />} onClick={handlePrune} title={t("Prune")} />
        <IconButton icon={<PurgeIcon className="w-3.5 h-3" />} onClick={handlePurge} title={t("Purge")}/>
      </div>
    </div>
  );
});

export default Breadcrumb;
