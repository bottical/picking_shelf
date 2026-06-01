(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const mgr = new SortStateManager(() => { }, (u) => { if (!u) location.href = 'index.html'; });
    const msg = $('msg');
    const preview = $('preview');

    const readRequiredColumn = (id, label) => {
      const raw = String($(id).value || '').trim();
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error(`${label}を指定してください（1以上の整数）`);
      return n - 1;
    };
    const readOptionalColumn = (id) => {
      const raw = String($(id).value || '').trim();
      if (!raw) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error('任意列は1以上の整数で指定してください');
      return n - 1;
    };

    const parseCsvText = (text) => {
      const rows = [];
      let row = [];
      let cell = '';
      let inQuotes = false;
      const src = String(text || '').replace(/^\uFEFF/, '');
      for (let i = 0; i < src.length; i += 1) {
        const c = src[i];
        const n = src[i + 1];
        if (c === '"') {
          if (inQuotes && n === '"') { cell += '"'; i += 1; } else { inQuotes = !inQuotes; }
        } else if (c === ',' && !inQuotes) {
          row.push(cell); cell = '';
        } else if ((c === '\n' || c === '\r') && !inQuotes) {
          if (c === '\r' && n === '\n') i += 1;
          row.push(cell); rows.push(row); row = []; cell = '';
        } else {
          cell += c;
        }
      }
      if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
      return rows;
    };

    const readRows = async (file) => {
      const name = (file?.name || '').toLowerCase();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        if (!window.XLSX) { throw new Error('Excel取込ライブラリを読み込めませんでした。ネットワーク環境を確認するか、CSV形式で取り込んでください。'); }
        const wb = XLSX.read(buf, { type: 'array' });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      }
      const buf = await file.arrayBuffer();
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (_) {
        text = new TextDecoder('shift_jis', { fatal: false }).decode(buf);
      }
      return parseCsvText(text);
    };

    $('importBtn').onclick = async () => {
      try {
        msg.textContent = '';
        const file = $('csvFile').files[0];
        if (!file) throw new Error('CSV/Excelファイルを選択してください');

        const cols = {
          jan: readRequiredColumn('colJan', 'バーコード列'),
          dest: readRequiredColumn('colDest', '仕分け先名列'),
          qty: readRequiredColumn('colQty', '数量列'),
          label: readOptionalColumn('colLabel'),
          dcode: readOptionalColumn('colDestCode')
        };

        const activeBatch = await mgr.getActiveBatch();
        if (activeBatch && !confirm('現在の卸仕分けバッチがあります。新しいCSVを取り込むと、現在の卸仕分け作業は切り替わります。続行しますか？')) return;
        if (activeBatch) await mgr.resetAll();

        const rows = await readRows(file);
        const warnings = [];
        const errors = [];
        const destinations = {};
        const destinationOrder = [];
        const items = {};

        for (let i = 1; i < rows.length; i += 1) {
          const r = rows[i] || [];
          const rowErrors = [];
          const jan = String(r[cols.jan] || '').trim();
          const destinationName = String(r[cols.dest] || '').trim();
          const qtyRaw = String(r[cols.qty] || '').trim();
          const qty = Number(qtyRaw);
          const productLabel = cols.label === null ? '' : String(r[cols.label] || '').trim();
          const destinationCode = cols.dcode === null ? '' : String(r[cols.dcode] || '').trim();

          if (!jan) rowErrors.push(`${i + 1}行目: バーコード空欄`);
          if (!destinationName) rowErrors.push(`${i + 1}行目: 仕分け先名空欄`);
          if (!Number.isFinite(qty)) rowErrors.push(`${i + 1}行目: 数量が数値でない`);
          if (qty < 0) rowErrors.push(`${i + 1}行目: 数量がマイナス`);
          if (rowErrors.length) { errors.push(...rowErrors); continue; }

          if (!productLabel) warnings.push(`${i + 1}行目: 商品表示名空欄`);
          if (!destinationCode) warnings.push(`${i + 1}行目: 仕分け先コード空欄`);
          if (qty === 0) warnings.push(`${i + 1}行目: 数量0`);
          if (qty <= 0) continue;

          if (!destinations[destinationName]) {
            const sortSlotId = `sortSlot${String(destinationOrder.length + 1).padStart(3, '0')}`;
            destinationOrder.push(destinationName);
            destinations[destinationName] = { sortSlotId, destinationCode, destinationName, displayOrder: destinationOrder.length };
          }
          const dest = destinations[destinationName];

          const itemKey = encodeURIComponent(jan);
          if (!items[itemKey]) {
            items[itemKey] = {
              itemKey, jan, productLabel: '', firstNonEmptyProductLabel: null, seenLabels: [], totalQty: 0, status: 'unstarted', allocations: {}
            };
          }
          const item = items[itemKey];
          if (productLabel) {
            if (!item.firstNonEmptyProductLabel) item.firstNonEmptyProductLabel = productLabel;
            if (!item.seenLabels.includes(productLabel)) item.seenLabels.push(productLabel);
          }
          item.totalQty += qty;
          if (!item.allocations[dest.sortSlotId]) {
            item.allocations[dest.sortSlotId] = {
              sortSlotId: dest.sortSlotId, destinationName: dest.destinationName, requiredQty: 0, status: 'required',
              doneAt: null, doneByDeviceId: null, cancelCount: 0, lastUpdatedAt: null
            };
          }
          item.allocations[dest.sortSlotId].requiredQty += qty;
        }

        if (errors.length) throw new Error(errors.join('\n'));
        Object.values(items).forEach((item) => {
          if (item.seenLabels.length > 1) warnings.push(`JAN ${item.jan}: 同一JANに複数の商品表示名が存在`);
          item.productLabel = item.firstNonEmptyProductLabel || '';
          delete item.firstNonEmptyProductLabel;
          delete item.seenLabels;
        });

        const destinationMap = {};
        Object.values(destinations).forEach((d) => { destinationMap[d.sortSlotId] = d; });
        const batchName = file.name;
        const totalQty = Object.values(items).reduce((a, b) => a + b.totalQty, 0);
        await mgr.createBatch({
          batchName, sourceFileName: file.name,
          destinationCount: Object.keys(destinationMap).length,
          itemCount: Object.keys(items).length,
          totalQty,
          destinations: destinationMap,
          items
        });

        preview.textContent = `バッチ名: ${batchName}\nSKU数: ${Object.keys(items).length}\n仕分け先数: ${Object.keys(destinationMap).length}\n総数量: ${totalQty}\n警告件数: ${warnings.length}\n${Object.values(destinationMap).map((d) => `No.${String(d.displayOrder).padStart(3, '0')} ${d.destinationName}`).join('\n')}`;
        msg.style.color = 'var(--success)';
        msg.textContent = '取込完了';
      } catch (e) {
        msg.style.color = 'var(--danger)';
        msg.textContent = e.message;
      }
    };

    $('resetBtn').onclick = async () => {
      if (!confirm('現在の卸仕分けバッチと実績状態を削除します。\n既存の投入・ピッキングデータには影響しません。\nよろしいですか？')) return;
      await mgr.resetAll();
      alert('卸仕分けデータをリセットしました');
    };
  });
})();
