import { createServer as create_server } from 'node:http';
import { readFile as read_file } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..', process.argv.includes('--release') ? 'dist' : '.');
const PORT = Number(process.env.PORT) || 8000;
const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.zip': 'application/zip'
};
create_server(async (_request, _response) => {
	try {
		const _url  = new URL(_request.url, 'http://localhost');
		const _path = decodeURIComponent(_url.pathname);
		const _file = resolve(ROOT, '.' + (_path === '/' ? '/index.html' : _path));
		if(!_file.startsWith(ROOT + '/')) {
			_response.writeHead(403).end();
			return;
		}
		const _content = await read_file(_file);
		_response.writeHead(200, {
			'Content-Type': MIME[extname(_file)] || 'application/octet-stream',
			'Cache-Control': 'no-store'
		});
		_response.end(_content);
	} catch {
		_response.writeHead(404).end();
	}
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}`));
