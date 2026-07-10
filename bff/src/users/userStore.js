'use strict';
/*
 * 사용자 저장소 추상화.
 * - UserStore: 인터페이스. DB 전환 시 이 계약만 구현하면 된다.
 * - FileUserStore: 초기 구현 (bff/data/users.json, .gitignore 대상).
 * - TODO(db): DbUserStore (예: PostgreSQL/SQLite) 어댑터를 추가하고
 *   createUserStore()에서 USERS_BACKEND 환경변수로 분기.
 */
const fs = require('fs/promises');
const path = require('path');

class UserStore {
  /** @returns {Promise<{username:string, passwordHash:string, roles:string[]}|null>} */
  async findByUsername(_username) { throw new Error('not implemented'); }
  /** 존재하면 갱신, 없으면 생성 */
  async upsert(_user) { throw new Error('not implemented'); }
  async list() { throw new Error('not implemented'); }
}

class FileUserStore extends UserStore {
  constructor(filePath) {
    super();
    this.filePath = filePath;
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data.users) ? data.users : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async _save(users) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ users }, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  async findByUsername(username) {
    const users = await this._load();
    return users.find((u) => u.username === username) || null;
  }

  async upsert(user) {
    const users = await this._load();
    const idx = users.findIndex((u) => u.username === user.username);
    const record = {
      username: user.username,
      passwordHash: user.passwordHash,
      roles: user.roles || ['admin'],
      updatedAt: new Date().toISOString(),
      createdAt: idx >= 0 ? users[idx].createdAt : new Date().toISOString(),
    };
    if (idx >= 0) users[idx] = record;
    else users.push(record);
    await this._save(users);
    return record;
  }

  async list() {
    return (await this._load()).map(({ username, roles, createdAt }) => ({ username, roles, createdAt }));
  }
}

function createUserStore(config) {
  // TODO(db): if (process.env.USERS_BACKEND === 'db') return new DbUserStore(...);
  return new FileUserStore(config.usersFile);
}

module.exports = { UserStore, FileUserStore, createUserStore };
