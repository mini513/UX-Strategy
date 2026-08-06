/**
 * UX Strategy Toolkit — Storage Utility
 * LocalStorage 기반 측정 이력 관리
 */
const UXStorage = {
  PREFIX: 'ux-toolkit',

  _key(module, key) {
    return `${this.PREFIX}-${module}-${key}`;
  },

  save(module, key, data) {
    try {
      localStorage.setItem(this._key(module, key), JSON.stringify(data));
    } catch (e) {
      console.warn('Storage save failed:', e);
    }
  },

  load(module, key) {
    try {
      const raw = localStorage.getItem(this._key(module, key));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  remove(module, key) {
    localStorage.removeItem(this._key(module, key));
  },

  saveHistory(module, label, data) {
    const history = this.getHistory(module);
    history.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      module,
      label,
      data,
      timestamp: new Date().toISOString(),
    });
    if (history.length > 100) history.length = 100;
    localStorage.setItem(this._key(module, 'history'), JSON.stringify(history));
  },

  getHistory(module) {
    try {
      const raw = localStorage.getItem(this._key(module, 'history'));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  getAllHistory() {
    const modules = ['sus', 'heuristic', 'priority', 'before-after', 'kano', 'first-click', 'five-second'];
    const all = [];
    modules.forEach(m => {
      all.push(...this.getHistory(m));
    });
    return all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  clearModule(module) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${this.PREFIX}-${module}`)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  },

  clearAll() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  },

  exportAll() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.PREFIX)) {
        data[k] = JSON.parse(localStorage.getItem(k));
      }
    }
    return data;
  },

  importAll(data) {
    Object.entries(data).forEach(([k, v]) => {
      if (k.startsWith(this.PREFIX)) {
        localStorage.setItem(k, JSON.stringify(v));
      }
    });
  },

  /* ── Template Management ── */
  saveTemplate(module, name, data) {
    const templates = this.getTemplates(module);
    templates.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      data,
      createdAt: new Date().toISOString(),
    });
    if (templates.length > 50) templates.length = 50;
    localStorage.setItem(this._key(module, 'templates'), JSON.stringify(templates));
  },

  getTemplates(module) {
    try {
      const raw = localStorage.getItem(this._key(module, 'templates'));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  loadTemplate(module, id) {
    const templates = this.getTemplates(module);
    return templates.find(t => t.id === id) || null;
  },

  deleteTemplate(module, id) {
    const templates = this.getTemplates(module).filter(t => t.id !== id);
    localStorage.setItem(this._key(module, 'templates'), JSON.stringify(templates));
  }
};

/* ── Chart Color Palette ── */
const UXColors = {
  primary: '#4F46E5',
  secondary: '#0EA5E9',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  purple: '#8B5CF6',
  pink: '#EC4899',
  teal: '#14B8A6',

  palette: [
    '#4F46E5', '#0EA5E9', '#10B981', '#F59E0B',
    '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6',
    '#F97316', '#6366F1',
  ],

  paletteAlpha(alpha = 0.2) {
    return this.palette.map(c => c + Math.round(alpha * 255).toString(16).padStart(2, '0'));
  }
};

/* ── Export Utility ── */
const UXExport = {
  downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    this._download(blob, filename);
  },

  downloadCSV(rows, filename) {
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    this._download(blob, filename);
  },

  downloadCanvas(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  },

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
};

/* ── Date Formatting ── */
const UXDate = {
  format(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },
  today() {
    return new Date().toISOString().slice(0, 10);
  }
};
