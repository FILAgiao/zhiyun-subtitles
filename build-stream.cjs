const esbuild=require('esbuild');
esbuild.buildSync({entryPoints:['progressive-cache.mjs'],bundle:true,format:'iife',globalName:'ZYProgressive',minify:true,outfile:'progressive-cache.bundle.js',banner:{js:'/*! Includes MP4Box.js 2.4.1 (BSD-3-Clause), Copyright Telecom ParisTech/TSI/MM/GPAC Cyril Concolato. See THIRD_PARTY_NOTICES.md in https://github.com/FILAgiao/zhiyun-subtitles */'}});
