"""Reuse explicitly mounted model configuration without copying credentials.

Only the three model fields enter the server environment. Drop the initial
container uid before importing the application or reading any uploaded data.
"""
import os
import sys
from dotenv import dotenv_values

path = os.environ.pop('CHART_MODEL_ENV_FILE', '')
if path:
    values = dotenv_values(path)
    for target, fallback in [('CHART_MODEL', 'LLM_MODEL'), ('CHART_API_BASE', 'LLM_API_BASE'),
                             ('CHART_API_KEY', 'LLM_API_KEY')]:
        if not os.environ.get(target):
            os.environ[target] = values.get(target) or values.get(fallback) or ''
if os.getuid() == 0:
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
os.execvp(sys.executable, [sys.executable, '-m', 'chart_platform.server', *sys.argv[1:]])
