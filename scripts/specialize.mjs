import { parse } from 'acorn';
import { DEFAULT_CONFIG } from '../src/core/defaults.js';
import { COPY } from '../src/copy.js';

export function walk_ast(_node, _callback, _parent = null) {
	if(!_node || typeof _node !== 'object') return;
	if(_node.type && _callback(_node, _parent) === false) return;
	for(const [_key, _value] of Object.entries(_node)) {
		if(_key === 'start' || _key === 'end') continue;
		if(Array.isArray(_value)) {
			for(const _child of _value) walk_ast(_child, _callback, _node);
		} else if(_value && typeof _value === 'object') {
			walk_ast(_value, _callback, _node);
		}
	}
}

export function replace_ranges(_code, _changes) {
	_changes.sort((_a, _b) => _b[0] - _a[0] || _b[1] - _a[1]);
	let _boundary = _code.length;
	for(const [_start, _end, _replacement] of _changes) {
		if(_end > _boundary) throw new Error('Overlapping source edits');
		_code = _code.slice(0, _start) + _replacement + _code.slice(_end);
		_boundary = _start;
	}
	return _code;
}

export function specialize(_code, _file) {
	if(_file.endsWith('core/defaults.js')) return 'export const DEFAULT_CONFIG = {};';
	const _changes  = [];
	const _ast      = parse(_code, { ecmaVersion: 'latest', sourceType: 'module' });
	const _is_world = _file.endsWith('core/world.js');
	const _is_main  = _file.endsWith('client/main.js');
	const _is_ui    = _file.endsWith('client/ui.js');
	walk_ast(_ast, _node => {
		const _source = _code.slice(_node.start, _node.end);
		const replace = _value => {
			_changes.push([_node.start, _node.end, _value]);
			return false;
		};
		if(_is_world) {
			if(_node.type === 'MethodDefinition' && _node.key.name === 'join_human') {
				// the shipped client always joins the first slot.
				return replace(`join_human() {
					const _actor = this.actors[0], _position = { x: _actor.x, y: _actor.y };
					Object.assign(_actor, this.fresh_actor(0), {
						input_kind: 'human', name: COPY.player_name, score: 0, ..._position
					});
					return 0;
				}`);
			}
			if(_node.type === 'ExpressionStatement') {
				if(_source.startsWith('this.result_inputs') || _source.startsWith('this.results_until')) return replace('');
				const _expression = _node.expression;
				const _left       = _expression.left;
				if(_expression.type === 'AssignmentExpression' && _left.object?.type === 'ThisExpression') {
					if(_left.property.name === 'config') return replace('this.config = {};');
					if(['result_inputs', 'results_until'].includes(_left.property.name)) return replace('');
				}
				if(_expression.type === 'CallExpression' && _expression.callee.property?.name === 'emit') {
					if(!['pickup', 'hit'].includes(_expression.arguments[0].value)) return replace('');
				}
			}
			if(_node.type === 'NewExpression' && _node.callee.name === 'Random') {
				return replace(`new Random(_overrides.seed ?? ${DEFAULT_CONFIG.seed})`);
			}
			if(_node.type === 'IfStatement' && _node.test.type === 'BinaryExpression') {
				if(
					_node.test.left.property?.name === 'round_phase' &&
					_node.test.right.value === 'results'
				) {
					return replace("if(this.round_phase === 'results') return;");
				}
			}
		}
		if(_is_main) {
			if(
				_node.type === 'ImportDeclaration' &&
				_node.specifiers.some(_item => _item.imported?.name === 'apply_copy')
			) {
				return replace('');
			}
			if(_node.type === 'ExpressionStatement' && _node.expression.callee?.name === 'apply_copy') return replace('');
		}
		if(_is_ui && _node.type === 'ExpressionStatement') {
			if(
				_source.startsWith("node('timer-ring')") ||
				_source.startsWith("node('round-callout').dataset.phase")
			) {
				return replace('');
			}
		}
		if(_node.type === 'MemberExpression' && !_node.computed) {
			const _owner = _node.object;
			if(
				(_owner.type === 'Identifier' && _owner.name === '_config') ||
				_owner.property?.name === 'config'
			) {
				const _key = _node.property.name;
				if(!(_key in DEFAULT_CONFIG)) throw new Error(`Unknown config key: ${_key}`);
				return replace(`(${JSON.stringify(DEFAULT_CONFIG[_key])})`);
			}
		}
		if(_is_ui && _source === "COPY.text['dash-button']") return replace(JSON.stringify(COPY.text['dash-button']));
		if(_file.endsWith('/src/copy.js') && _node.type === 'Property' && _node.key.name === 'text') {
			_changes.push([_node.start, _node.end + 1, '']);
			return false;
		}
	});
	return replace_ranges(_code, _changes);
}
