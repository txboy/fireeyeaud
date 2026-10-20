"""工作区元数据写入锁。

sidecar 内 sync / import / reflect / delete 会在线程池中并发执行；
所有涉及 project.json、files.json、schema.json 的读改写都必须持有同一把锁。
"""

from __future__ import annotations

import threading

WORKSPACE_MUTATION_LOCK = threading.RLock()
