import { PALETTE, color_count, color_indices, mixed_color, orb_angle } from '../core/colors.js';
import { pickup_tail } from './pickup-visual.js';
import { lock_reticle, stun_stars, impact_star } from './status-visual.js';
import { PickupPulses } from './pickup-pulses.js';
import { append_trail, trail_style, trim_trail } from './trails.js';
import { UNICORN_FACES } from './unicorn-model.js';
import { PonyPoses } from './pony-pose.js';
import { offset } from '../core/movement.js';
const TAU      = Math.PI * 2;
const _colors  = new Map();
const CIRCLE   = Array.from({ length: 13 }, (_, i) => [Math.cos((i / 12) * TAU), Math.sin((i / 12) * TAU)]);
const _circles = new Map();

function circle(_segments) {
	if(!_circles.has(_segments))
		_circles.set(
			_segments,
			Array.from({ length: _segments + 1 }, (_, i) => [
				Math.cos((i / _segments) * TAU),
				Math.sin((i / _segments) * TAU)
			])
		);
	return _circles.get(_segments);
}
const EDGES = new Map();
UNICORN_FACES.forEach(_face =>
	_face.forEach((_a, i) => {
		const _b   = _face[(i + 1) % _face.length];
		const _key = [Math.min(_a, _b), Math.max(_a, _b)].join(':');
		if(!EDGES.has(_key)) EDGES.set(_key, { a: _a, b: _b });
	})
);

function rgb(_hex) {
	if(!_colors.has(_hex)) {
		const _n = parseInt(_hex.slice(1), 16);
		_colors.set(
			_hex,
			[(_n >> 16) & 255, (_n >> 8) & 255, _n & 255].map(_v => _v / 255)
		);
	}
	return _colors.get(_hex);
}

class Batch {
	constructor() {
		this.data   = new Float32Array(65536);
		this.length = 0;
	}

	vertex(_x, _y, _z, _color, _alpha = 1) {
		if(this.length + 7 > this.data.length) {
			const _next = new Float32Array(this.data.length * 2);
			_next.set(this.data);
			this.data = _next;
		}
		const _d = this.data;
		let i    = this.length;
		_d[i++] = _x;
		_d[i++] = _y;
		_d[i++] = _z;
		_d[i++] = _color[0];
		_d[i++] = _color[1];
		_d[i++] = _color[2];
		_d[i++] = _alpha;
		this.length = i;
	}

	triangle(_a, _b, _c, _color, _alpha = 1) {
		this.vertex(_a[0], _a[1], _a[2], _color, _alpha);
		this.vertex(_b[0], _b[1], _b[2], _color, _alpha);
		this.vertex(_c[0], _c[1], _c[2], _color, _alpha);
	}
}

export class Renderer {
	constructor(_canvas) {
		this.canvas   = _canvas;
		this.gl       = _canvas.getContext('webgl', { alpha: false, antialias: false, stencil: true });
		this.camera_x = this.camera_y = 0;
		this.tilt     = 0.74;
		this.opaque   = new Batch();
		this.models   = new Batch();
		this.outlines        = new Batch();
		this.effects         = new Batch();
		this.trails          = new Map();
		this.last_trail_time = -Infinity;
		this.last_round      = null;
		this.pickup_pulses   = new PickupPulses();
		this.pony_poses    = new PonyPoses();
		this.pulse_mask    = new Batch();
		this.pulse_outline = new Batch();
		this.guides        = new Batch();
		this.setup();
		this.resize();
	}

	setup() {
		const _gl      = this.gl;
		const _program = _gl.createProgram();
		const _sources = [
			`attribute vec3 p;attribute vec4 c;uniform vec4 camera;uniform vec2 tilt;varying vec4 color;
            void main(){vec3 q=p-vec3(camera.xy,0.);gl_Position=vec4(q.x*camera.z,(-q.y*tilt.x+q.z*tilt.y)*camera.w,-(q.y*tilt.y+q.z*tilt.x)/2048.,1.);color=c;}`,
			`precision mediump float;varying vec4 color;void main(){gl_FragColor=color;}`
		];
		_sources.forEach((_source, i) => {
			const _shader = _gl.createShader(i ? _gl.FRAGMENT_SHADER : _gl.VERTEX_SHADER);
			_gl.shaderSource(_shader, _source);
			_gl.compileShader(_shader);
			_gl.attachShader(_program, _shader);
			_gl.deleteShader(_shader);
		});
		_gl.linkProgram(_program);
		_gl.useProgram(_program);
		this.camera_uniform = _gl.getUniformLocation(_program, 'camera');
		this.tilt_uniform   = _gl.getUniformLocation(_program, 'tilt');
		_gl.bindBuffer(_gl.ARRAY_BUFFER, _gl.createBuffer());
		for(const [_name, _size, _offset] of [
			['p', 3, 0],
			['c', 4, 12]
		]) {
			const _location = _gl.getAttribLocation(_program, _name);
			_gl.enableVertexAttribArray(_location);
			_gl.vertexAttribPointer(_location, _size, _gl.FLOAT, false, 28, _offset);
		}
		_gl.enable(_gl.DEPTH_TEST);
		_gl.depthFunc(_gl.LEQUAL);
		_gl.disable(_gl.CULL_FACE);
		_gl.clearColor(...rgb('#020308'), 1);
	}

	resize() {
		const _w     = this.canvas.clientWidth || innerWidth;
		const _h     = this.canvas.clientHeight || innerHeight;
		const _ratio = Math.min(0.5, 800 / Math.max(_w, _h));
		this.width   = Math.max(1, Math.round(_w * _ratio));
		this.height  = Math.max(1, Math.round(_h * _ratio));
		this.canvas.width = this.width;
		this.canvas.height = this.height;
		this.zoom = Math.min(this.width / 650, this.height / 530);
		// keep the visible region inside one repeat, including mesh/effect margins.
		if(this.config)
			this.zoom = Math.max(
				this.zoom,
				this.width / (2 * this.config.arena_x - 256),
				this.height / ((2 * this.config.arena_y - 256) * this.tilt)
			);
		this.gl.viewport(0, 0, this.width, this.height);
	}
	get height_tilt() {
		return Math.sqrt(1 - this.tilt ** 2);
	}

	project(_x, _y, _z = 0) {
		return {
			x: this.width / 2 + (_x - this.camera_x) * this.zoom,
			y: this.height / 2 + ((_y - this.camera_y) * this.tilt - _z * this.height_tilt) * this.zoom,
			depth: (_y - this.camera_y) * this.height_tilt + _z * this.tilt
		};
	}

	unproject(_x, _y) {
		const _rect = this.canvas.getBoundingClientRect();
		return {
			x: this.camera_x + (((_x - _rect.left) / _rect.width) * this.width - this.width / 2) / this.zoom,
			y:
				this.camera_y +
				(((_y - _rect.top) / _rect.height) * this.height - this.height / 2) / this.zoom / this.tilt
		};
	}

	movement(_x, _y) {
		return { x: _x, y: _y };
	}

	near(_point, _origin = { x: this.camera_x, y: this.camera_y }) {
		const _delta = offset(_origin, _point, this.config);
		return { ..._point, x: _origin.x + _delta.x, y: _origin.y + _delta.y };
	}

	visible(_x, _y, _z, _radius) {
		const _p = this.project(_x, _y, _z);
		const _r = _radius * this.zoom;
		return _p.x + _r >= 0 && _p.x - _r <= this.width && _p.y + _r >= 0 && _p.y - _r <= this.height;
	}

	triangle(_a, _b, _c, _color, _lit = false, _alpha = 1, _emission = 0) {
		if(_lit) {
			const _ux = _b[0] - _a[0];
			const _uy = _b[1] - _a[1];
			const _uz = _b[2] - _a[2];
			const _vx = _c[0] - _a[0];
			const _vy = _c[1] - _a[1];
			const _vz = _c[2] - _a[2];
			const _nx    = _uy * _vz - _uz * _vy;
			const _ny    = _uz * _vx - _ux * _vz;
			const _nz    = _ux * _vy - _uy * _vx;
			const _shade =
				0.48 +
				0.52 * Math.abs((-0.45 * _nx - 0.65 * _ny + _nz) / (Math.hypot(_nx, _ny, _nz) * 1.275 || 1));
			_color = _color.map(_v => _v * (_emission + (1 - _emission) * _shade));
		}
		this.models.triangle(_a, _b, _c, _color, _alpha);
	}

	ring(_x, _y, _radius, _hex, _z = 0.5, _width = 1.2, _segments = 32) {
		({ x: _x, y: _y } = this.near({ x: _x, y: _y }));
		if(!this.visible(_x, _y, _z, _radius)) return;
		const _color  = rgb(_hex);
		const _points = circle(_segments);
		for(let i = 0; i < _segments; i++) {
			const [_ax, _ay] = _points[i];
			const [_bx, _by] = _points[i + 1];
			const p = _r => [_x + _ax * _r, _y + _ay * _r, _z];
			const q = _r => [_x + _bx * _r, _y + _by * _r, _z];
			this.opaque.triangle(p(_radius), q(_radius), p(_radius - _width), _color);
			this.opaque.triangle(q(_radius), q(_radius - _width), p(_radius - _width), _color);
		}
	}

	glow(_x, _y, _z, _hex, _radius = 3.5) {
		({ x: _x, y: _y } = this.near({ x: _x, y: _y }));
		if(!this.visible(_x, _y, _z, _radius * 4)) return;
		const _color = rgb(_hex);
		const _core  = _color;
		const _t     = this.tilt;
		const _h     = this.height_tilt;
		for(let i = 0; i < 12; i++) {
			const [_ax, _ay] = CIRCLE[i];
			const [_bx, _by] = CIRCLE[i + 1];
			this.opaque.vertex(_x, _y, _z, _core);
			this.opaque.vertex(_x + _ax * _radius, _y + _ay * _radius * _t, _z - _ay * _radius * _h, _color);
			this.opaque.vertex(_x + _bx * _radius, _y + _by * _radius * _t, _z - _by * _radius * _h, _color);
			this.effects.vertex(_x, _y, _z, _color, 0.25);
			this.effects.vertex(
				_x + _ax * _radius * 4,
				_y + _ay * _radius * 4 * _t,
				_z - _ay * _radius * 4 * _h,
				_color,
				0
			);
			this.effects.vertex(
				_x + _bx * _radius * 4,
				_y + _by * _radius * 4 * _t,
				_z - _by * _radius * 4 * _h,
				_color,
				0
			);
		}
	}

	ribbon(_a, _b, _hex, _alpha, _width = 1) {
		_a = this.near(_a);
		_b = this.near(_b, _a);
		const _pa     = this.project(_a.x, _a.y, _a.z);
		const _pb     = this.project(_b.x, _b.y, _b.z);
		const _margin = _width * 4 * this.zoom;
		if(
			Math.max(_pa.x, _pb.x) < -_margin ||
			Math.min(_pa.x, _pb.x) > this.width + _margin ||
			Math.max(_pa.y, _pb.y) < -_margin ||
			Math.min(_pa.y, _pb.y) > this.height + _margin
		)
			return;
		const _dx     = _b.x - _a.x;
		const _dy     = (_b.y - _a.y) * this.tilt - (_b.z - _a.z) * this.height_tilt;
		const _length = Math.hypot(_dx, _dy) || 1;
		const _x      = (-_dy / _length) * _width;
		const _y      = (_dx / _length) * _width;
		const _t      = this.tilt;
		const _h     = this.height_tilt;
		const _color = rgb(_hex);
		const vertex = (_p, _side, _opacity) =>
			this.effects.vertex(
				_p.x + _x * _side,
				_p.y + _y * _t * _side,
				_p.z - _y * _h * _side,
				_color,
				_alpha * _opacity
			);
		// a bright center strip with interpolated, transparent edges. Still one effects draw.
		for(const [_left, _right, _al, _ar] of [
			[-4, -0.35, 0, 1],
			[-0.35, 0.35, 1, 1],
			[0.35, 4, 1, 0]
		]) {
			vertex(_a, _left, _al);
			vertex(_a, _right, _ar);
			vertex(_b, _left, _al);
			vertex(_b, _left, _al);
			vertex(_a, _right, _ar);
			vertex(_b, _right, _ar);
		}
	}

	pony_vertices(_actor, _world) {
		return this.pony_poses
			.sample(_actor, _world)
			.map(([_x, _y, _z]) => [_actor.x + _x, _actor.y + _y, _z]);
	}

	pony(_actor, _world) {
		_actor = this.near(_actor);
		if(!this.visible(_actor.x, _actor.y, 20, 75)) return;
		const _vertices = this.pony_vertices(_actor, _world);
		const _blink    = _actor.color_mask && _actor.invulnerable_until > _world.now;
		let _hex = _actor.color_mask ? mixed_color(_actor.color_mask) : '#505058';
		if(_blink && Math.floor(_world.now * 10) % 2) _hex = '#e2dfec';
		const _color = rgb(_hex);
		for(const _face of UNICORN_FACES)
			for(let i = 1; i < _face.length - 1; i++)
				this.triangle(
					_vertices[_face[0]],
					_vertices[_face[i]],
					_vertices[_face[i + 1]],
					_color,
					true,
					1,
					_actor.color_mask === 63 ? 0.8 : 0
				);
		this.outline_geometry(_vertices, this.outlines, rgb('#ffffff'));
	}

	outline_geometry(_vertices, _batch, _color, _alpha = 1) {
		// dilate the low-resolution mesh by 1.25 pixels. The stencil rejects every interior
		// pixel, including overlapping paper faces, leaving only the visual contour.
		const _projected = _vertices.map(_v => this.project(..._v));
		const _t         = this.tilt;
		const _h         = this.height_tilt;
		const _width     = 1.25 / this.zoom;
		const shifted    = (i, _x, _y) => [
			_vertices[i][0] + _x,
			_vertices[i][1] + _y * _t + _h * 0.08,
			_vertices[i][2] - _y * _h + _t * 0.08
		];
		for(const { a: _a, b: _b } of EDGES.values()) {
			const _dx     = _projected[_b].x - _projected[_a].x;
			const _dy     = _projected[_b].y - _projected[_a].y;
			const _length = Math.hypot(_dx, _dy);
			if(_length < 0.001) continue;
			const _x   = (-_dy / _length) * _width;
			const _y   = (_dx / _length) * _width;
			const edge = (i, _side) => shifted(i, _x * _side, _y * _side);
			const _al  = edge(_a, -1);
			const _ar  = edge(_a, 1);
			const _bl  = edge(_b, -1);
			const _br = edge(_b, 1);
			_batch.triangle(_al, _ar, _bl, _color, _alpha);
			_batch.triangle(_bl, _ar, _br, _color, _alpha);
		}
		for(let i = 0; i < _vertices.length; i++)
			for(let j = 0; j < 12; j++) {
				_batch.triangle(
					shifted(i, 0, 0),
					shifted(i, CIRCLE[j][0] * _width, CIRCLE[j][1] * _width),
					shifted(i, CIRCLE[j + 1][0] * _width, CIRCLE[j + 1][1] * _width),
					_color,
					_alpha
				);
			}
	}

	draw_pickup_silhouettes(_waves, _world) {
		const _gl = this.gl;
		const _t  = this.tilt;
		const _h  = this.height_tilt;
		_gl.disable(_gl.DEPTH_TEST);
		_gl.depthMask(false);
		_gl.enable(_gl.BLEND);
		_gl.blendFunc(_gl.SRC_ALPHA, _gl.ONE_MINUS_SRC_ALPHA);
		_gl.enable(_gl.STENCIL_TEST);
		for(const _wave of _waves) {
			const _actor = _world.actors[_wave.actor_id];
			if(!_actor) continue;
			{
				const _points = this.pony_vertices({ ..._actor, x: 0, y: 0 }, _world).map(([_x, _y, _z]) => [
					_x,
					_y * _t - _z * _h
				]);
				const cx =
					(Math.min(..._points.map(_p => _p[0])) + Math.max(..._points.map(_p => _p[0]))) / 2;
				const cy =
					(Math.min(..._points.map(_p => _p[1])) + Math.max(..._points.map(_p => _p[1]))) / 2;
				_wave.source.pose = { cx, cy, points: _points.map(([_x, _y]) => [_x - cx, _y - cy]) };
			}
			const _center = this.near(_actor);
			const _pose   = _wave.source.pose;
			if(!this.visible(_center.x, _center.y, 20, 110)) continue;
			const _vertices = _pose.points.map(([_x, _y]) => {
				const _sy = _pose.cy + _y * _wave.scale;
				return [_center.x + _pose.cx + _x * _wave.scale, _center.y + _sy * _t, -_sy * _h];
			});
			this.pulse_mask.length = this.pulse_outline.length = 0;
			const _color = rgb(mixed_color(_wave.color));
			for(const _face of UNICORN_FACES)
				for(let i = 1; i < _face.length - 1; i++) {
					this.pulse_mask.triangle(
						_vertices[_face[0]],
						_vertices[_face[i]],
						_vertices[_face[i + 1]],
						_color
					);
				}
			this.outline_geometry(_vertices, this.pulse_outline, _color, _wave.alpha);
			_gl.stencilMask(255);
			_gl.clear(_gl.STENCIL_BUFFER_BIT);
			_gl.colorMask(false, false, false, false);
			_gl.stencilFunc(_gl.ALWAYS, 1, 255);
			_gl.stencilOp(_gl.KEEP, _gl.KEEP, _gl.REPLACE);
			this.flush(this.pulse_mask);
			_gl.colorMask(true, true, true, true);
			_gl.stencilFunc(_gl.NOTEQUAL, 1, 255);
			// mark each outline pixel after drawing so overlapping edge quads don't brighten it.
			this.flush(this.pulse_outline);
		}
		_gl.stencilMask(255);
		_gl.disable(_gl.STENCIL_TEST);
		_gl.enable(_gl.DEPTH_TEST);
		_gl.depthMask(true);
		_gl.disable(_gl.BLEND);
	}

	flush(_batch) {
		if(!_batch.length) return;
		const _gl = this.gl;
		_gl.bufferData(_gl.ARRAY_BUFFER, _batch.data.subarray(0, _batch.length), _gl.DYNAMIC_DRAW);
		_gl.drawArrays(_gl.TRIANGLES, 0, _batch.length / 7);
	}

	ground_grid() {
		const _config = this.config;
		if(_config.ground_grid_spacing <= 0 || _config.ground_grid_width <= 0) return;
		// an integer number of cells per arena repeat keeps the grid fixed through a wrap.
		const _sx =
			(2 * _config.arena_x) /
			Math.max(1, Math.round((2 * _config.arena_x) / _config.ground_grid_spacing));
		const _sy =
			(2 * _config.arena_y) /
			Math.max(1, Math.round((2 * _config.arena_y) / _config.ground_grid_spacing));
		const _half_x = this.width / (2 * this.zoom);
		const _half_y = this.height / (2 * this.zoom * this.tilt);
		const _left   = this.camera_x - _half_x - _sx;
		const _right  = this.camera_x + _half_x + _sx;
		const _top    = this.camera_y - _half_y - _sy;
		const _bottom = this.camera_y + _half_y + _sy;
		const _wx    = _config.ground_grid_width / (2 * this.zoom);
		const _wy    = _wx / this.tilt;
		const _color = rgb(_config.ground_grid_color);
		const quad   = (_x1, _y1, _x2, _y2) => {
			const _a = [_x1, _y1, 0];
			const _b = [_x2, _y1, 0];
			const _c = [_x2, _y2, 0];
			const _d = [_x1, _y2, 0];
			this.opaque.triangle(_a, _b, _c, _color);
			this.opaque.triangle(_a, _c, _d, _color);
		};
		for(let _x = Math.ceil(_left / _sx) * _sx; _x <= _right; _x += _sx)
			quad(_x - _wx, _top, _x + _wx, _bottom);
		for(let _y = Math.ceil(_top / _sy) * _sy; _y <= _bottom; _y += _sy)
			quad(_left, _y - _wy, _right, _y + _wy);
	}

	draw(_world, _player_id, _dt) {
		if(this.config !== _world.config) {
			this.config = _world.config;
			this.resize();
		}
		const _gl     = this.gl;
		const _player = _world.actors[_player_id];
		this.camera_x = _player.x;
		this.camera_y = _player.y;
		if(this.last_round !== _world.round) {
			this.trails.clear();
			this.last_round      = _world.round;
			this.last_trail_time = -Infinity;
		}
		this.opaque.length =
			this.models.length =
			this.outlines.length =
			this.effects.length =
			this.guides.length =
				0;
		_gl.depthMask(true);
		_gl.stencilMask(255);
		_gl.disable(_gl.BLEND);
		_gl.clear(_gl.COLOR_BUFFER_BIT | _gl.DEPTH_BUFFER_BIT | _gl.STENCIL_BUFFER_BIT);
		_gl.uniform4f(
			this.camera_uniform,
			this.camera_x,
			this.camera_y,
			(2 * this.zoom) / this.width,
			(2 * this.zoom) / this.height
		);
		_gl.uniform2f(this.tilt_uniform, this.tilt, this.height_tilt);
		this.ground_grid();
		this.flush(this.opaque);
		this.opaque.length = 0;
		for(let i = 0; i < 70; i++) {
			const _x = Math.sin(i * 127.1) * _world.config.arena_x;
			const _y = Math.cos(i * 79.7) * _world.config.arena_y;
			this.ring(_x, _y, 1, '#12212b', 0.1, 0.5, 8);
		}
		const _config = _world.config;
		const _sample = _dt > 0 && _world.now - this.last_trail_time >= _config.trail_sample_seconds;
		if(_sample) this.last_trail_time = _world.now;
		const _active_keys = new Set();
		const _waves       = this.pickup_pulses.sample(_world.now, _world.round, _world.pickups);
		for(const _actor of _world.actors) {
			this.pony(_actor, _world);
			if(_actor.id === _player_id) {
				const _stroke = 1.25 / (this.zoom * this.tilt);
				this.ring(_actor.x, _actor.y, 25, '#8298a3', 0.5, _stroke);
				if(_actor.state !== 'flattened') {
					const _p = this.near(_actor);
					const cx = Math.cos(_actor.facing);
					const cy = Math.sin(_actor.facing);
					// keep the guide 1.5 pixels wide regardless of zoom.
					const _start = this.project(_p.x, _p.y, 0.3);
					const _end   = this.project(_p.x + cx * 110, _p.y + cy * 110, 0.3);
					for(const _point of [_start, _end]) {
						_point.x = Math.floor(_point.x) + 0.5;
						_point.y = Math.floor(_point.y) + 0.5;
					}
					const _dx     = _end.x - _start.x;
					const _dy     = _end.y - _start.y;
					const _length = Math.hypot(_dx, _dy) || 1;
					const _nx     = (-_dy / _length) * 0.75;
					const _ny     = (_dx / _length) * 0.75;
					const ground  = (_x, _y) => [
						this.camera_x + (_x - this.width / 2) / this.zoom,
						this.camera_y +
							((_y - this.height / 2) / this.zoom + 0.3 * this.height_tilt) / this.tilt,
						0.3
					];
					const _a     = ground(_start.x + _nx, _start.y + _ny);
					const _b     = ground(_start.x - _nx, _start.y - _ny);
					const _c     = ground(_end.x + _nx, _end.y + _ny);
					const _d     = ground(_end.x - _nx, _end.y - _ny);
					const _color = rgb('#354650');
					this.guides.vertex(..._a, _color, 1);
					this.guides.vertex(..._b, _color, 1);
					this.guides.vertex(..._c, _color, 0);
					this.guides.vertex(..._c, _color, 0);
					this.guides.vertex(..._b, _color, 1);
					this.guides.vertex(..._d, _color, 0);
				}
			}
			if(_actor.state === 'stunned')
				for(const { center: _center, points: _points } of stun_stars(
					_actor,
					_world.now,
					this.tilt
				)) {
					const _origin   = this.near(_center);
					const _vertices = _points.map(_p => this.near(_p, _origin));
					const position  = _p => [_p.x, _p.y, _p.z];
					for(let i = 1; i < _vertices.length; i++)
						this.opaque.triangle(
							position(_origin),
							position(_vertices[i - 1]),
							position(_vertices[i]),
							rgb('#ffe600')
						);
				}
			if(_sample && _actor.dash_until > _world.now) {
				const _key   = `dash:${_actor.id}`;
				const _trail = this.trails.get(_key) || [];
				append_trail(_trail, {
					x: _actor.x,
					y: _actor.y,
					z: _config.dash_trail_height,
					color: mixed_color(_actor.color_mask),
					time: _world.now,
					...trail_style(_config, color_count(_actor.color_mask), true)
				});
				this.trails.set(_key, _trail);
			}
			for(const i of color_indices(_actor.color_mask)) {
				const _angle = orb_angle(i, _world.now, _actor.id, _actor.color_mask);
				const _key   = `${_actor.id}:${i}`;
				const _orb   = {
					x: _actor.x + Math.cos(_angle) * 31,
					y: _actor.y + Math.sin(_angle) * 31,
					z: 19,
					color: PALETTE[i]
				};
				this.glow(_orb.x, _orb.y, _orb.z, _orb.color);
				_active_keys.add(_key);
				if(_sample) {
					// six narrow lanes leave the rear of the body, not the orbiting orbs.
					const _style = trail_style(_config, color_count(_actor.color_mask));
					const _side  = (i - 2.5) * _config.trail_lane_spacing * _style.scale;
					const _cf    = Math.cos(_actor.facing);
					const _sf    = Math.sin(_actor.facing);
					const _trail = this.trails.get(_key) || [];
					append_trail(_trail, {
						x: _actor.x - _cf * _config.trail_rear_offset - _sf * _side,
						y: _actor.y - _sf * _config.trail_rear_offset + _cf * _side,
						z: _actor.state === 'flattened' ? 1 : _config.trail_height,
						color: PALETTE[i],
						time: _world.now,
						..._style
					});
					this.trails.set(_key, _trail);
				}
			}
		}
		for(const [_key, _trail] of this.trails) {
			const _emitting = _key.startsWith('dash:')
				? _world.actors[Number(_key.slice(5))].dash_until > _world.now
				: _active_keys.has(_key);
			if(!_emitting) _trail.emitting = false;
			trim_trail(_trail, _world.now, _config);
			if(!_trail.length && !_active_keys.has(_key)) {
				this.trails.delete(_key);
				continue;
			}
			for(let i = 1; i < _trail.length; i++) {
				if(_trail[i].break_before) continue;
				const _fade = Math.max(0, 1 - (_world.now - _trail[i].time) / _trail[i].lifetime);
				this.ribbon(
					_trail[i - 1],
					_trail[i],
					_trail[i].color,
					_fade ** _config.trail_fade_exponent * _config.trail_opacity,
					_trail[i].width / 8
				);
			}
		}
		for(const _p of _world.pickups) {
			const _color = PALETTE[Math.log2(_p.color)];
			const _tail  = pickup_tail(_p, _world);
			if(_tail) {
				this.ribbon(_tail, _p, _color, 0.9, 2.4);
				this.glow(_tail.x, _tail.y, _tail.z, _color, 2.8);
			}
			if(!_tail) this.ring(_p.x, _p.y, 5, '#354650', 0.3, 1.2, 12);
			this.glow(_p.x, _p.y, _p.z, _color, 4.5);
		}
		for(const _shot of _world.shots) {
			const _head = { x: _shot.x, y: _shot.y, z: 20 };
			const _age  = Math.min(0.045, _world.now - _shot.born_at);
			const _tail = { x: _shot.x - _shot.vx * _age, y: _shot.y - _shot.vy * _age, z: 20 };
			this.ribbon(_tail, _head, '#ffffff', 0.85, 0.8);
			this.glow(_shot.x, _shot.y, 20, '#ffffff', 5);
		}
		const _target = _player && _world.combo_victim(_player);
		if(_target)
			for(const _bracket of lock_reticle(_target, _world.now, this.tilt)) {
				for(let i = 1; i < _bracket.length; i++)
					this.ribbon(_bracket[i - 1], _bracket[i], '#a5f4ff', 1, 0.85 / this.zoom);
			}
		this.flush(this.opaque);
		_gl.enable(_gl.BLEND);
		_gl.blendFunc(_gl.SRC_ALPHA, _gl.ONE_MINUS_SRC_ALPHA);
		_gl.depthMask(false);
		this.flush(this.guides);
		_gl.depthMask(true);
		_gl.enable(_gl.STENCIL_TEST);
		_gl.stencilFunc(_gl.ALWAYS, 1, 255);
		_gl.stencilOp(_gl.KEEP, _gl.KEEP, _gl.REPLACE);
		this.flush(this.models);
		_gl.disable(_gl.BLEND);
		_gl.enable(_gl.STENCIL_TEST);
		_gl.stencilMask(0);
		_gl.stencilFunc(_gl.NOTEQUAL, 1, 255);
		_gl.stencilOp(_gl.KEEP, _gl.KEEP, _gl.KEEP);
		_gl.depthMask(false);
		this.flush(this.outlines);
		_gl.disable(_gl.STENCIL_TEST);
		_gl.enable(_gl.BLEND);
		_gl.blendFunc(_gl.SRC_ALPHA, _gl.ONE);
		_gl.depthMask(false);
		this.flush(this.effects);
		_gl.depthMask(true);
		_gl.disable(_gl.BLEND);
		if(_waves.length) this.draw_pickup_silhouettes(_waves, _world);
		// draw the screen-facing impact over the scene with a contrasting rim.
		this.opaque.length = 0;
		for(const _actor of _world.actors) {
			const _flash = impact_star(this.near(_actor), _world, this.tilt);
			if(!_flash) continue;
			const { center: _center, points: _points, white: _white } = _flash;
			const _origin = [_center.x, _center.y, _center.z];
			for(const _scale of [1.1, 1]) {
				const _color    = rgb(_white === (_scale === 1) ? '#ffffff' : '#000000');
				const _vertices = _points.map(_p =>
					_origin.map((_v, i) => _v + ([_p.x, _p.y, _p.z][i] - _v) * _scale)
				);
				for(let i = 1; i < _vertices.length; i++)
					this.opaque.triangle(_origin, _vertices[i - 1], _vertices[i], _color);
			}
		}
		_gl.disable(_gl.DEPTH_TEST);
		this.flush(this.opaque);
		_gl.enable(_gl.DEPTH_TEST);
	}
}
