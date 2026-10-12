const esbuild = require('esbuild');
const fs = require('fs');

// html2canvas 1.4.1 waits indefinitely for a cloned page's load and fonts.
// Patch only the bundled copy, and fail the build if the dependency layout changes.
const boundedAssets = {
  name: 'bounded-capture-assets',
  setup(build) {
    build.onLoad({filter: /html2canvas(?:\.esm)?\.js$/}, async args => {
      let contents = fs.readFileSync(args.path, 'utf8');
      for (const value of ['documentClone.fonts.ready', 'imagesReady(documentClone)']) {
        const needle = 'return [4 /*yield*/, ' + value + '];';
        if (!contents.includes(needle)) throw Error('html2canvas wait layout changed');
        contents = contents.replace(needle,
          'return [4 /*yield*/, Promise.race([' + value + ', new Promise(function(resolve){setTimeout(resolve,600);})])];');
      }
      const begin = contents.indexOf('var iframeLoader = function (iframe) {');
      const end = contents.indexOf('var ignoredStyleProperties = [', begin);
      if (begin < 0 || end < 0) throw Error('html2canvas iframe loader changed');
      contents = contents.slice(0, begin) + `var iframeLoader = function (iframe) {
        return new Promise(function(resolve, reject) {
          var started = Date.now();
          var interval = setInterval(function() {
            var win = iframe.contentWindow, doc = win && win.document;
            if (!iframe.isConnected || !win) {
              clearInterval(interval); reject(new Error('Capture frame removed')); return;
            }
            if (doc.body && doc.body.childNodes.length &&
                (doc.readyState === 'complete' || Date.now() - started >= 600)) {
              clearInterval(interval); resolve(iframe);
            }
          }, 25);
        });
      };\n` + contents.slice(end);
      return {contents, loader: 'js'};
    });
  }
};
esbuild.build({entryPoints: ['card-render.mjs'], bundle: true, minify: true,
  format: 'iife', globalName: 'ZYCardRender', outfile: 'card-render.bundle.js',
  legalComments: 'inline', plugins: [boundedAssets]
}).then(() => {
  fs.appendFileSync('card-render.bundle.js', '\nglobalThis.ZYCardRender=ZYCardRender;\n');
  console.log('Built offline Markdown card renderer with bounded capture waits.');
}).catch(e => {console.error(e); process.exitCode = 1;});
