import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import MarkdownIt from 'markdown-it';
const context=vm.createContext({window:{markdownit:MarkdownIt}});
vm.runInContext(await readFile(new URL('./public/markdown.js',import.meta.url),'utf8'),context);
const render=text=>{context.markdownText=text;return vm.runInContext('markdownRenderer.render(markdownText)',context);};

test('回复解析标题、强调、列表、引用和代码，保留代码原文',()=>{
 const html=render('# 标题\n\n**粗体**和*斜体*及`a < b`\n\n- 第一项\n- 第二项\n\n> 引用\n\n```js\nconst value = "<script>";\n```');
 for(const tag of ['h1','strong','em','ul','li','blockquote','pre','code'])assert.match(html,new RegExp('<'+tag+'[ >]'));
 assert.match(html,/const value = &quot;&lt;script&gt;&quot;/);
});

test('表格通过 CSS 类对齐，符合禁止内联样式的 CSP',()=>{
 const html=render('| 左 | 右 | 中 |\n| :--- | ---: | :---: |\n| A | B | C |');
 assert.match(html,/<table>/);assert.match(html,/class="align-left"/);assert.match(html,/class="align-right"/);assert.match(html,/class="align-center"/);assert.doesNotMatch(html,/style=/);
});

test('HTML 和代码中的可执行内容均作为文本，危险链接不生成锚点',()=>{
 const html=render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n[x](jav&#x61;script:alert(1))\n\n[x](data:text/html,test)\n\n```html\n</code></pre><script>alert(1)</script>\n```');
 assert.doesNotMatch(html,/<script|<img|<a\b/i);assert.match(html,/&lt;script&gt;/);
});

test('普通链接正常排版，图片引用不自动请求图片',()=>{
 const html=render('[链接](https://example.com/?a=1&b=2)\n\n![示意图](https://example.com/image.png)\n\n![内嵌图](data:image/png;base64,AAAA)');
 assert.match(html,/<a href="https:\/\/example.com\/\?a=1&amp;b=2">链接<\/a>/);
 assert.match(html,/<a href="https:\/\/example.com\/image.png">示意图<\/a>/);
 assert.doesNotMatch(html,/<img|href="data:/);
});
