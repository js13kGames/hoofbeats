import { crc32, deflateRawSync as deflate_raw } from 'node:zlib';

export function zip_html(_html) {
	const _name       = Buffer.from('index.html');
	const _data       = Buffer.from(_html);
	const _compressed = deflate_raw(_data, { level: 9 });
	const _local      = Buffer.alloc(30);
	const _central    = Buffer.alloc(46);
	const _end        = Buffer.alloc(22);
	_local.writeUInt32LE(0x04034b50);
	_local.writeUInt16LE(20, 4);
	_local.writeUInt16LE(8, 8);
	_local.writeUInt16LE(33, 12); // 1980-01-01; no variable timestamps or extra fields.
	_local.writeUInt32LE(crc32(_data), 14);
	_local.writeUInt32LE(_compressed.length, 18);
	_local.writeUInt32LE(_data.length, 22);
	_local.writeUInt16LE(_name.length, 26);
	_central.writeUInt32LE(0x02014b50);
	_central.writeUInt16LE(20, 4);
	_local.copy(_central, 6, 4, 30);
	_end.writeUInt32LE(0x06054b50);
	_end.writeUInt16LE(1, 8);
	_end.writeUInt16LE(1, 10);
	_end.writeUInt32LE(_central.length + _name.length, 12);
	_end.writeUInt32LE(_local.length + _name.length + _compressed.length, 16);
	return Buffer.concat([_local, _name, _compressed, _central, _name, _end]);
}
