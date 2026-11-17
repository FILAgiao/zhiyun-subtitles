/* Render model-generated Mermaid as static, non-interactive diagrams. */
(function (root, loadMermaid) {
  'use strict';
  const maxTextSize = 12000;
  let mermaid, nextId = 0;

  async function render(doc, source) {
    const text = source.trim();
    if (!text || text.length > maxTextSize) throw Error('Invalid diagram length');
    const flowchartFragment = /^(?:[\w-]+\s*(?:\[|\(|\{|<?(?:--|==|-\.)))/;
    const diagram = flowchartFragment.test(text) ? 'flowchart LR\n' + text : text;
    // Keep diagram configuration and remote image shapes out of model output.
    if (/^---(?:\s|$)|%%\s*\{|@\s*\{[^}]*\bimg\s*:/i.test(diagram)) throw Error('Unsupported diagram configuration');

    if (!mermaid) {
      mermaid = loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        maxTextSize,
        maxEdges: 100,
        suppressErrorRendering: true,
        fontFamily: 'Arial, "Microsoft YaHei", sans-serif'
      });
    }

    const id = 'zy-mermaid-' + ++nextId;
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none';
    stage.setAttribute('aria-hidden', 'true');
    document.body.append(stage);
    try {
      const {svg} = await mermaid.render(id, diagram, stage);
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
      if (parsed.localName !== 'svg') throw Error('Missing diagram SVG');
      for (const link of parsed.querySelectorAll('a')) {
        link.removeAttribute('href');
        link.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
      }
      const width = Number(parsed.getAttribute('viewBox')?.trim().split(/\s+/)[2]);
      if (!Number.isFinite(width) || width <= 0) throw Error('Invalid diagram width');
      const image = doc.createElement('img');
      image.alt = parsed.querySelector('title')?.textContent || 'Mermaid 图表';
      image.style.cssText = 'display:block;width:' + Math.ceil(width) + 'px;max-width:none;height:auto;margin:0 auto';
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(parsed));
      await image.decode();
      return image;
    } finally {
      stage.remove();
    }
  }

  root.ZYDiagram = {render};

})(globalThis, ZYLoadMermaid);
