"""Start only this project; do not stop existing listeners or alter credentials."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import time

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8897)
parser.add_argument('--model-env-file', type=Path)
parser.add_argument('--proxy')
parser.add_argument('--node')
parser.add_argument('--soffice')
args = parser.parse_args()
with socket.socket() as sock:
    sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    sock.bind(('127.0.0.1', args.port))
env = os.environ.copy()
for key,value in [('CHART_MODEL_ENV_FILE',args.model_env_file),('CHART_PROXY_URL',args.proxy),
                  ('CHART_NODE_BINARY',args.node),('CHART_SOFFICE',args.soffice)]:
    if value:env[key]=str(value)
(root/'.runtime').mkdir(exist_ok=True)
command=[str(root/'.venv/bin/python'),'-m','chart_platform.server','--port',str(args.port),
         '--runtime-file',str(root/'.runtime/server.json')]
with (root/'.runtime/server.log').open('ab') as log:
    proc=subprocess.Popen(command,cwd=root,env=env,stdout=log,stderr=log,start_new_session=True)
time.sleep(.5)
if proc.poll() is not None:
    raise SystemExit('Chartloom did not start; inspect .runtime/server.log.')
(root/'.runtime/launch.json').write_text(json.dumps({'pid':proc.pid,'cwd':str(root),'command':command,
    'port':args.port,'modelConfig':'explicit environment reference; values never stored'},indent=2))
print(json.dumps({'pid':proc.pid,'url':f'http://127.0.0.1:{args.port}/'}))
