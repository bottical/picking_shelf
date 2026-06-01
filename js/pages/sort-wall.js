(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const deviceId = localStorage.getItem('sortDeviceId') || crypto.randomUUID();
    localStorage.setItem('sortDeviceId', deviceId);

    let snapshot = null;
    const mgr = new SortStateManager((s) => { snapshot = s; render(); }, (u) => { if (!u) location.href = 'index.html'; });

    $('toggleCfg').onclick = () => $('cfgWrap').classList.toggle('open');
    $('start').value = localStorage.getItem('sortSlotStartIndex') || 1;
    $('count').value = localStorage.getItem('sortSlotCount') || 4;
    $('scale').value = localStorage.getItem('sortDisplayScale') || 'M';
    const escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    $('save').onclick = () => {
      localStorage.setItem('sortSlotStartIndex', $('start').value);
      localStorage.setItem('sortSlotCount', $('count').value);
      localStorage.setItem('sortDisplayScale', $('scale').value);
      location.reload();
    };

    async function updateAllocationTransactional(batchId, itemKey, sortSlotId, toDone) {
      const ref = mgr.batchDoc(batchId);
      await mgr.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('バッチが見つかりません');
        const batch = snap.data();
        const item = batch.items?.[itemKey];
        if (!item) throw new Error('SKUが見つかりません');
        const allocation = item.allocations?.[sortSlotId];
        if (!allocation) throw new Error('仕分け先が見つかりません');

        const values = Object.values(item.allocations || {}).filter((v) => (v.requiredQty || 0) > 0);
        const simulated = values.map((v) => (v.sortSlotId === sortSlotId ? { ...v, status: toDone ? 'done' : 'required' } : v));
        const doneCount = simulated.filter((v) => v.status === 'done').length;
        const nextItemStatus = doneCount === 0 ? 'active' : doneCount === simulated.length ? 'completed' : 'partial';

        const base = `items.${itemKey}.allocations.${sortSlotId}`;
        tx.update(ref, {
          [`${base}.status`]: toDone ? 'done' : 'required',
          [`${base}.doneByDeviceId`]: toDone ? deviceId : null,
          [`${base}.doneAt`]: toDone ? firebase.firestore.FieldValue.serverTimestamp() : null,
          [`${base}.lastUpdatedAt`]: firebase.firestore.FieldValue.serverTimestamp(),
          [`${base}.cancelCount`]: toDone ? (allocation.cancelCount || 0) : ((allocation.cancelCount || 0) + 1),
          [`items.${itemKey}.status`]: nextItemStatus,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
    }

    function render() {
      const b = snapshot?.batch;
      const activeItemKey = snapshot?.sortState?.activeItemKey;
      const item = activeItemKey && b?.items?.[activeItemKey] ? b.items[activeItemKey] : null;
      $('sku').textContent = item ? `${item.productLabel || '商品表示名未設定'}\nJAN:${item.jan}` : 'スキャン待機中';

      const cards = $('cards');
      cards.innerHTML = '';
      if (!b?.destinations) { cards.textContent = 'バッチ未作成'; return; }

      const start = Number(localStorage.getItem('sortSlotStartIndex') || 1);
      const count = Number(localStorage.getItem('sortSlotCount') || 4);
      const selected = Object.values(b.destinations).sort((a, c) => a.displayOrder - c.displayOrder).slice(start - 1, start - 1 + count);

      selected.forEach((dest) => {
        const itemKey = item?.itemKey;
        const alloc = item?.allocations?.[dest.sortSlotId];
        const card = document.createElement('div');
        if (!itemKey && alloc) return;
        card.className = `slot-card ${!alloc ? 'none' : ''} ${alloc?.status === 'done' ? 'done' : ''}`;
        card.innerHTML = `<div>仕分け先 No.${String(dest.displayOrder).padStart(3, '0')}</div><strong>${escapeHtml(dest.destinationName)}</strong>`;

        if (!alloc) {
          card.innerHTML += '<div>今回投入なし</div>';
        } else if (alloc.status === 'done') {
          card.innerHTML += '<div>完了<br>長押しで取消</div><div class="long"><span></span></div>';
        } else {
          card.innerHTML += `<div>${escapeHtml(item.productLabel || '商品表示名未設定')}</div><div>JAN:${escapeHtml(item.jan)}</div><div class='qty'>${alloc.requiredQty}</div>`;
        }

        if (alloc?.status === 'required') {
          card.onclick = async () => {
            try { await updateAllocationTransactional(b.id, itemKey, dest.sortSlotId, true); } catch (e) { $('err').textContent = e.message; }
          };
        }

        if (alloc?.status === 'done') {
          let t = null;
          let raf = null;
          const bar = card.querySelector('.long > span');
          const clear = () => { clearTimeout(t); if (raf) cancelAnimationFrame(raf); if (bar) bar.style.width = '0%'; };
          card.onpointerdown = () => {
            const startedAt = performance.now();
            const tick = () => {
              const p = Math.min(1, (performance.now() - startedAt) / 900);
              if (bar) bar.style.width = `${p * 100}%`;
              if (p < 1) raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
            t = setTimeout(async () => {
              try { await updateAllocationTransactional(b.id, itemKey, dest.sortSlotId, false); } catch (e) { $('err').textContent = e.message; }
              clear();
            }, 900);
          };
          card.onpointerup = clear;
          card.onpointerleave = clear;
          card.onpointercancel = clear;
        }

        cards.appendChild(card);
      });
    }
  });
})();
