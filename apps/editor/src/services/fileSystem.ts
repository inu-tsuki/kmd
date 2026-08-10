// File System Access API 封装
// 支持：Chrome 86+, Edge 86+（Firefox/Safari 不支持）

export interface FileNode {
  name: string
  kind: 'file' | 'directory'
  path: string              // 相对项目根的路径，如 "scripts/intro.kmd"
  handle: FileSystemHandle
  children?: FileNode[]    // 仅 directory
}

// ─── IndexedDB 持久化 ────────────────────────────────────────────────────────

const DB_NAME = 'kmd-fs'
const STORE_NAME = 'handles'
const HANDLE_KEY = 'projectRoot'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY)
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null)
    req.onerror = () => reject(req.error)
  })
}

// ─── 公开 API ────────────────────────────────────────────────────────────────

export const isFsaSupported = (): boolean => 'showDirectoryPicker' in window

export async function openFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await saveHandle(handle)
  return handle
}

export async function restoreHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await loadHandle()
    if (!handle) return null
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') return handle
    // 需要用户手势才能请求权限，静默失败
    return null
  } catch {
    return null
  }
}

export async function readDirectory(
  dirHandle: FileSystemDirectoryHandle,
  basePath = ''
): Promise<FileNode[]> {
  const nodes: FileNode[] = []
  for await (const [name, handle] of dirHandle.entries()) {
    const path = basePath ? `${basePath}/${name}` : name
    if (handle.kind === 'directory') {
      const children = await readDirectory(handle as FileSystemDirectoryHandle, path)
      nodes.push({ name, kind: 'directory', path, handle, children })
    } else {
      nodes.push({ name, kind: 'file', path, handle })
    }
  }
  // 目录在前，同类按名称排序
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

export async function readFile(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile()
  return file.text()
}

/**
 * Read a UTF-8 text file below a project root. The path must remain relative to
 * that root; absolute paths and parent traversal are deliberately rejected.
 */
export async function readProjectTextFile(
  projectRoot: FileSystemDirectoryHandle,
  relativePath: string
): Promise<string | null> {
  const normalized = relativePath.trim().replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error(`Project file path must be relative: ${relativePath}`)
  }

  const segments = normalized.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0 || segments.some(segment => segment === '..')) {
    throw new Error(`Project file path escapes the project root: ${relativePath}`)
  }

  try {
    let directory = projectRoot
    for (const segment of segments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment)
    }
    const fileName = segments[segments.length - 1]!
    return await readFile(await directory.getFileHandle(fileName))
  } catch (error) {
    if (typeof DOMException !== 'undefined' &&
        error instanceof DOMException && error.name === 'NotFoundError') return null
    if (error instanceof Error && error.name === 'NotFoundError') return null
    throw error
  }
}

export async function writeFile(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

export async function createFile(
  dirHandle: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemFileHandle> {
  return dirHandle.getFileHandle(name, { create: true })
}
