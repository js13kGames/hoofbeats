import { offset } from '../core/movement.js';

export function bind_press(_button, _action) {
	_button.addEventListener('pointerdown', _event => {
		if(_button.disabled || _event.button !== 0) return;
		_event.preventDefault();
		_action();
	});
	_button.addEventListener('click', _event => {
		if(!_button.disabled && _event.detail === 0) _action();
	});
}

function track_pointer(_element, _active, _update) {
	let _pointer_id = null;
	const clear     = () => {
		const _previous = _pointer_id;
		_pointer_id = null;
		if(_previous !== null && _element.hasPointerCapture(_previous))
			_element.releasePointerCapture(_previous);
		_update(null);
	};
	_element.addEventListener('pointerdown', _event => {
		if(!_active() || _event.button !== 0 || _pointer_id !== null) return;
		_pointer_id = _event.pointerId;
		_element.setPointerCapture(_pointer_id);
		_update(_event);
		_event.preventDefault();
	});
	_element.addEventListener('pointermove', _event => {
		if(_pointer_id === _event.pointerId) _update(_event);
	});
	for(const _type of ['pointerup', 'pointercancel', 'lostpointercapture'])
		_element.addEventListener(_type, _event => {
			if(_pointer_id === _event.pointerId) clear();
		});
	return clear;
}

export class InputController {
	constructor(_canvas, _renderer, _callbacks) {
		this.keys       = new Set();
		this.renderer   = _renderer;
		const _movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
		addEventListener('keydown', _event => {
			const _code = _event.code;
			if(_event.ctrlKey || _event.metaKey || _event.altKey) return;
			if(_code === 'Escape') {
				if(!_event.repeat) _callbacks.pause();
				return;
			}
			if(!_callbacks.active()) return;
			if(_movement.includes(_code)) {
				this.keys.add(_code);
				_event.preventDefault();
			}
			if(['KeyE', 'KeyK', 'KeyX', 'KeyQ'].includes(_code)) {
				_event.preventDefault();
				if(!_event.repeat) _callbacks.shoot();
			}
			if(['Space', 'KeyJ', 'KeyZ', 'ShiftLeft', 'ShiftRight'].includes(_code)) {
				_event.preventDefault();
				if(!_event.repeat) {
					_callbacks.dash();
				}
			}
		});
		addEventListener('keyup', _event => this.keys.delete(_event.code));
		addEventListener('blur', () => {
			this.clear();
			_callbacks.blur();
		});
		const _joystick   = document.getElementById('joystick');
		const _thumb      = document.getElementById('joystick-thumb');
		this.clear_canvas = track_pointer(_canvas, _callbacks.active, _event => {
			this.pointer = _event && { x: _event.clientX, y: _event.clientY };
		});
		this.clear_stick = track_pointer(_joystick, _callbacks.active, _event => {
			const _rect   = _joystick.getBoundingClientRect();
			const _x      = _event ? (_event.clientX - _rect.left - _rect.width / 2) / 36 : 0;
			const _y      = _event ? (_event.clientY - _rect.top - _rect.height / 2) / 36 : 0;
			const _length = Math.max(1, Math.hypot(_x, _y));
			this.stick    = { x: _x / _length, y: _y / _length };
			_thumb.style.transform = `translate(${this.stick.x * 30}px,${this.stick.y * 30}px)`;
		});
		this.clear();
	}

	clear() {
		this.keys.clear();
		this.clear_canvas();
		this.clear_stick();
	}

	sample(_actor) {
		const held = (..._codes) => Number(_codes.some(_code => this.keys.has(_code)));
		let _x     = held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft');
		let _y     = held('KeyS', 'ArrowDown') - held('KeyW', 'ArrowUp');
		if(_x || _y) return this.renderer.movement(_x, _y);
		if(this.stick.x || this.stick.y) return this.renderer.movement(this.stick.x, this.stick.y);
		if(this.pointer) {
			const _target = this.renderer.unproject(this.pointer.x, this.pointer.y);
			_x = _target.x - _actor.x;
			_y = _target.y - _actor.y;
			if(this.renderer.config) ({ x: _x, y: _y } = offset(_actor, _target, this.renderer.config));
			const _distance = Math.hypot(_x, _y);
			if(_distance >= 7) return { x: _x / Math.max(42, _distance), y: _y / Math.max(42, _distance) };
		}
		return { x: 0, y: 0 };
	}
}
