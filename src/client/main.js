import { World } from '../core/world.js';
import { Renderer } from './webgl-renderer.js';
import { UI } from './ui.js';
import { InputController, bind_press } from './input.js';
import { apply_copy } from './copy.js';

apply_copy();

let _paused           = false;
let _last_time        = performance.now();
let _accumulator      = 0;
let _impact_slow_left = 0;

// menu time and renderer history belong to a separate round.
const _world = new World({ seed: (Math.random() * 2 ** 32) >>> 0 });
const _demo  = new World({ seed: (Math.random() * 2 ** 32) >>> 0 });
_demo.round       = -1;
_demo.round_phase = 'playing';

const ui_element = _id => document.getElementById(_id);
const _player_id = _world.join_human();
const _renderer  = new Renderer(ui_element('arena'));
const _ui        = new UI();
const _inputs    = new Map();
const _fixed_step = 1 / _world.config.tick_rate;


////////////////////////////
// round flow

function can_play() {
	return _ui.screen === 'game' && !_paused && _world.round_phase === 'playing';
}

function game_pause(_value = !_paused) {
	if(_ui.screen !== 'game') return;
	_paused = _value;
	_input.clear();
	_accumulator = 0;
	_ui.update(_world, _player_id, _paused);
	if(_paused) ui_element('resume').focus();
}

function game_dash() {
	if(can_play()) _world.dash(_player_id);
}

function game_start() {
	_ui.start(() => {
		if(_world.round_phase === 'results') _world.start_next_round();
		_paused = false;
		_input.clear();
		_accumulator      = 0;
		_impact_slow_left = 0;
		_last_time        = performance.now();
	});
}


////////////////////////////
// input

const _input = new InputController(ui_element('arena'), _renderer, {
	active: can_play,
	dash: game_dash,
	shoot: () => { if(can_play()) _world.shoot(_player_id); },
	pause: () => game_pause(),
	blur: () => game_pause(true)
});

bind_press(ui_element('dash-button'), game_dash);
bind_press(ui_element('shoot-button'), () => { if(can_play()) _world.shoot(_player_id); });
bind_press(ui_element('pause-button'), () => game_pause());
ui_element('resume').addEventListener('click', () => game_pause(false));
ui_element('pause-title').addEventListener('click', () => {
	_input.clear();
	_accumulator      = 0;
	_impact_slow_left = 0;
	_paused           = false;
	_world.start_next_round();
	_ui.show('home');
});

ui_element('start-game').addEventListener('click', game_start);
ui_element('play-again').addEventListener('click', game_start);
document.addEventListener('visibilitychange', () => {
	if(document.hidden) game_pause(true);
	_last_time   = performance.now();
	_accumulator = 0;
});
addEventListener('resize', () => _renderer.resize());


////////////////////////////
// frame

function game_frame(_time) {
	const _elapsed = Math.min(0.1, Math.max(0, (_time - _last_time) / 1000));
	_last_time = _time;

	if(_ui.screen === 'game' && !_paused && _world.round_phase !== 'results') {
		// hit slowdown spends real time while the simulation advances at 10% speed.
		const _slowed = _world.round_phase === 'playing' ? Math.min(_elapsed, _impact_slow_left) : 0;
		_impact_slow_left -= _slowed;
		_accumulator += _elapsed - _slowed * 0.9;

		let _ticks = 0;
		while(_accumulator >= _fixed_step && _ticks < 6) {
			_inputs.set(_player_id, can_play() ? _input.sample(_world.actors[_player_id]) : { x: 0, y: 0 });
			const _phase = _world.round_phase;
			_world.step(_fixed_step, _inputs);
			if(_phase !== _world.round_phase) _input.clear();
			_accumulator -= _fixed_step;
			_ticks++;
			if(_world.round_phase === 'results') {
				_accumulator = 0;
				break;
			}
		}
		if(_ticks === 6) _accumulator = 0;
	}

	for(const _event of _world.drain_events()) {
		if(_event.type === 'hit' && _event.attacker_id === _player_id && _world.round_phase === 'playing') {
			_impact_slow_left = 0.1;
		}
		_renderer.pickup_pulses.add(_event, _world.round);
	}

	if(_ui.screen === 'game') {
		_renderer.draw(_world, _player_id, _paused || _world.round_phase === 'results' ? 0 : _elapsed);
	}
	if(_ui.screen === 'home' && !document.hidden) {
		_demo.simulate(_elapsed);
		for(const _event of _demo.drain_events()) _renderer.pickup_pulses.add(_event, _demo.round);
		_renderer.draw(_demo, 0, _elapsed);
	}
	_ui.update(_world, _player_id, _paused, document.hidden ? 0 : _elapsed);
	requestAnimationFrame(game_frame);
}

_ui.update(_world, _player_id, _paused);
requestAnimationFrame(game_frame);
