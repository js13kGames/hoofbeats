import { readFile as read_file, writeFile as write_file, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { execFileSync as exec_file_sync } from 'node:child_process';
import vm from 'node:vm';
import { minify } from 'terser';
import { parse } from 'acorn';
import { specialize, walk_ast, replace_ranges } from './specialize.mjs';
import { pack_html, emit_html, normalize_html } from './pack.mjs';
import { zip_html } from './zip.mjs';
import { COPY } from '../src/copy.js';
const ROOT     = resolve(import.meta.dirname, '..');
const LIMIT    = 13312;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_';

async function find_source(_directory) {
	const _files = [];
	for(const _entry of await readdir(_directory, { withFileTypes: true })) {
		const _file = join(_directory, _entry.name);
		if(_entry.isDirectory()) _files.push(...(await find_source(_file)));
		else if(_file.endsWith('.js')) _files.push(_file);
	}
	return _files;
}

function rename_properties(_code, _native) {
	const _ast         = parse(_code, { ecmaVersion: 'latest' });
	const _names       = new Set();
	const _definitions = new Set();
	const _strings     = new Set();
	const _frequency   = new Map();
	walk_ast(_ast, _node => {
		if(_node.type === 'MemberExpression' && !_node.computed) {
			const _name = _node.property.name;
			_names.add(_name);
			_frequency.set(_name, (_frequency.get(_name) || 0) + 1);
		}
		if(
			_node.type === 'AssignmentExpression' &&
			_node.left.type === 'MemberExpression' &&
			!_node.left.computed
		) {
			_definitions.add(_node.left.property.name);
		}
		if(
			['Property', 'MethodDefinition', 'PropertyDefinition'].includes(_node.type) &&
			!_node.computed &&
			_node.key.type === 'Identifier'
		) {
			_names.add(_node.key.name);
			_definitions.add(_node.key.name);
		}
		if(_node.type === 'Literal' && typeof _node.value === 'string') _strings.add(_node.value);
	});
	const _reserved = new Set([
		..._native,
		..._strings,
		'phase',
		'alpha',
		'block',
		'preventScroll',
		'antialias',
		'stencil',
		'depth',
		'desynchronized',
		'willReadFrequently',
		'once',
		'capture',
		'passive',
		'signal',
		'behavior',
		'inline',
		'constructor',
		'prototype',
		'__proto__'
	]);
	const _owned      = new Set(['color_mask', 'state', 'speed', 'sample', 'update', 'screen']);
	const _properties = [..._definitions].filter(_key => !_reserved.has(_key) || _owned.has(_key));
	_properties.sort(
		(_a, _b) => (_frequency.get(_b) || 0) - (_frequency.get(_a) || 0) || _a.localeCompare(_b)
	);
	const _map  = Object.create(null);
	let _serial = 0;
	function next_name() {
		let _number = _serial++;
		let _name   = '';
		do {
			_name += ALPHABET[_number % ALPHABET.length];
			_number = Math.floor(_number / ALPHABET.length);
		} while(_number);
		return _name;
	}

	for(const _key of _properties) {
		let _name;
		do {
			_name = next_name();
		} while(_names.has(_name) || _reserved.has(_name));
		_map[_key] = _name;
	}
	const _changes = [];
	walk_ast(_ast, _node => {
		if(_node.type === 'MemberExpression' && !_node.computed && _map[_node.property.name]) {
			_changes.push([_node.property.start, _node.property.end, _map[_node.property.name]]);
		}
		if(
			['Property', 'MethodDefinition', 'PropertyDefinition'].includes(_node.type) &&
			!_node.computed &&
			_map[_node.key.name]
		) {
			const _name = _map[_node.key.name] + (_node.shorthand ? ':' + _node.key.name : '');
			_changes.push([_node.key.start, _node.key.end, _name]);
		}
	});
	return { code: replace_ranges(_code, _changes), map: _map };
}
await mkdir(join(ROOT, '.build'), { recursive: true });
await mkdir(join(ROOT, 'dist'), { recursive: true });
for(const _file of await find_source(join(ROOT, 'src'))) {
	const _target = _file.replace(join(ROOT, 'src'), join(ROOT, '.build/src'));
	await mkdir(dirname(_target), { recursive: true });
	const _code = (await read_file(_file, 'utf8')).replace(/webgl-renderer\.js/g, 'canvas-renderer.js');
	await write_file(_target, specialize(_code, _file));
}
exec_file_sync(
	process.env.BUN_EXE || 'bun',
	[
		'build',
		'.build/src/client/main.js',
		'--target=browser',
		'--format=iife',
		'--minify',
		'--outfile=.build/bundle.js'
	],
	{ cwd: ROOT, stdio: 'pipe' }
);
const _native  = JSON.parse(await read_file(join(ROOT, 'scripts/vendor/native-properties.json'), 'utf8'));
const _renamed = rename_properties(await read_file(join(ROOT, '.build/bundle.js'), 'utf8'), _native);
const _script  = (await minify(_renamed.code, { compress: { passes: 3 }, mangle: true, ecma: 2020 })).code;
await write_file(join(ROOT, '.build/property-map.json'), JSON.stringify(_renamed.map));
await write_file(join(ROOT, '.build/game.js'), _script);
const _css = (await read_file(join(ROOT, 'style.compact.css'), 'utf8'))
	.replace(/\s+/g, ' ')
	.replace(/\s*([{}:;,])\s*/g, '$1')
	.trim();
let _html = (await read_file(join(ROOT, 'index.html'), 'utf8'))
	.replace(/\s*\n\s*/g, ' ').replace(/>\s+</g, '><');
_html = _html
	.replace(/<link rel="stylesheet" href="style\.css"\s*\/?>/, `<style>${_css}</style>`)
	.replace(
		'<script type="module" src="src/client/main.js"></script>',
		() => `<script>${_script.replace(/<\/script/gi, '<\\/script')}</script>`
	);
for(const [_id, _value] of Object.entries(COPY.text)) {
	const _pattern = new RegExp('(<[^>]+\\bid="' + _id + '"[^>]*>)(</[^>]+>)');
	if(!_pattern.test(_html)) throw new Error(`Missing text target: ${_id}`);
	const _escaped = _value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	_html = _html.replace(_pattern, (_match, _open, _close) => _open + _escaped + _close);
}
_html = _html.replace('<div id="timer-ring"></div>', '').replace('#timer-ring{display:none}', '');
await write_file(join(ROOT, '.build/game.html'), _html);
const _options    = JSON.parse(await read_file(join(ROOT, 'scripts/pack-options.json'), 'utf8'));
const _normalized = normalize_html(_html);
const _packed     = await emit_html(pack_html(_normalized, _options));
let _decoded;
vm.runInNewContext(_packed.match(/<script>([\s\S]*?)<\/script>/)[1], {
	atob,
	document: {
		write: _value => {
			_decoded = _value;
		}
	}
});
if(_decoded !== _normalized) throw new Error('Packed document did not decode exactly');
const _zip = zip_html(Buffer.from(_packed));
await write_file(join(ROOT, 'dist/index.html'), _packed);
await write_file(join(ROOT, 'dist/Hoofbeats.zip'), _zip);
console.log(`Hoofbeats.zip: ${_zip.length} / ${LIMIT} bytes (${LIMIT - _zip.length} spare)`);
if(_zip.length > LIMIT) throw new Error('Submission exceeds 13 KiB');
