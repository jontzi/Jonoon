const fs = require('node:fs/promises');
const path = require('node:path');

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { devices: [] };
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!Array.isArray(this.data.devices)) this.data.devices = [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
    return this.data;
  }

  async save() {
    this.writeQueue = this.writeQueue.then(async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.writeFile(temporaryPath, JSON.stringify(this.data, null, 2), 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    });
    return this.writeQueue;
  }
}

module.exports = { JsonStore };
