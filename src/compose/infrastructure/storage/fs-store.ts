import { join } from 'path'
import { unlinkSync } from 'fs'
import { IStore } from '../../application/ports'
import { BASE_DIR, atomicWrite, readJsonFile, listJsonFiles, ensureDir } from './util'

export class FsStore<T extends { id: string }> implements IStore<T> {
  protected readonly dir: string

  constructor(subDir: string, baseDir?: string) {
    this.dir = join(baseDir ?? BASE_DIR, subDir)
    ensureDir(this.dir)
  }

  get(id: string): Promise<T | undefined> {
    return Promise.resolve(readJsonFile<T>(join(this.dir, `${id}.json`)))
  }

  getAll(): Promise<T[]> {
    const files = listJsonFiles(this.dir)
    const items = files
      .map((f) => readJsonFile<T>(join(this.dir, f)))
      .filter((item): item is T => item !== undefined)
    return Promise.resolve(items)
  }

  save(entity: T): Promise<void> {
    const filePath = join(this.dir, `${entity.id}.json`)
    atomicWrite(filePath, JSON.stringify(entity, null, 2))
    return Promise.resolve()
  }

  delete(id: string): Promise<void> {
    try {
      unlinkSync(join(this.dir, `${id}.json`))
    } catch {
      // ignore missing file
    }
    return Promise.resolve()
  }
}
