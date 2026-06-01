(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const SORT_COLORS = [
      '#2563eb',
      '#dc2626',
      '#16a34a',
      '#f59e0b',
      '#7c3aed',
      '#0891b2',
      '#db2777',
      '#65a30d'
    ];
    const deviceId = localStorage.getItem('sortDeviceId') || crypto.randomUUID();
    localStorage.setItem('sortDeviceId', deviceId);

    let snapshot = null;
    const mgr = new SortStateManager((s) => { snapshot = s; render(); }, (u) => { if (!u) location.href = 'index.html'; });

    const escapeHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const getSortColor = (displayOrder) => SORT_COLORS[(Math.max(1, Number(displayOrder || 1)) - 1) % SORT_COLORS.length];
    const getDisplayScale = () => localStorage.getItem('sortDisplayScale') || 'M';

    $('toggleCfg').onclick = () => $('cfgWrap').classList.toggle('open');
    $('start').value = localStorage.getItem('sortSlotStartIndex') || 1;
    $('count').value = localStorage.getItem('sortSlotCount') || 4;
    $('scale').value = getDisplayScale();
    document.body.dataset.sortScale = getDisplayScale().toLowerCase();

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

    function renderCardBase(card, dest) {
      card.style.setProperty('--sort-pick-color', getSortColor(dest.displayOrder));
      card.innerHTML = `
        <div class="sort-slot-no">仕分け先 No.${String(dest.displayOrder).padStart(3, '0')}</div>
        <div class="sort-slot-destination">${escapeHtml(dest.destinationName)}</div>
      `;
    }

    function render() {
      const b = snapshot?.batch;
      const activeItemKey = snapshot?.sortState?.activeItemKey;
      const item = activeItemKey && b?.items?.[activeItemKey] ? b.items[activeItemKey] : null;
      $('sku').textContent = item ? `${item.productLabel || '商品表示名未設定'} / JAN:${item.jan}` : 'スキャン待機中';

      const cards = $('cards');
      cards.innerHTML = '';
      if (!b?.destinations) {
        cards.innerHTML = '<div class="sort-slot-empty">バッチ未作成</div>';
        return;
      }

      const start = Number(localStorage.getItem('sortSlotStartIndex') || 1);
      const count = Number(localStorage.getItem('sortSlotCount') || 4);
      const selected = Object.values(b.destinations).sort((a, c) => a.displayOrder - c.displayOrder).slice(start - 1, start - 1 + count);

      selected.forEach((dest) => {
        const itemKey = item?.itemKey;
        const alloc = item?.allocations?.[dest.sortSlotId];
        const isDone = alloc?.status === 'done';
        const card = document.createElement('div');
        card.className = `sort-slot-card ${!alloc ? 'is-none' : isDone ? 'is-done' : 'is-required'}`;
        renderCardBase(card, dest);

        if (!alloc) {
          card.innerHTML += '<div class="sort-slot-none-label">今回投入なし</div>';
        } else if (isDone) {
          card.innerHTML += '<div class="sort-slot-done-label">完了</div><div class="sort-slot-hint">長押しで取消</div><div class="sort-long-progress"><span></span></div>';
        } else {
          card.innerHTML += `
            <div class="sort-slot-product">${escapeHtml(item.productLabel || '商品表示名未設定')}</div>
            <div class="sort-slot-jan">JAN: ${escapeHtml(item.jan)}</div>
            <div class="sort-slot-qty">${escapeHtml(alloc.requiredQty)}</div>
          `;
        }

        if (alloc?.status === 'required') {
          card.onclick = async () => {
            try {
              await updateAllocationTransactional(b.id, itemKey, dest.sortSlotId, true);
              $('err').textContent = '';
            } catch (e) { $('err').textContent = e.message; }
          };
        }

        if (isDone) {
          let t = null;
          let raf = null;
          const bar = card.querySelector('.sort-long-progress > span');
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
              try {
                await updateAllocationTransactional(b.id, itemKey, dest.sortSlotId, false);
                $('err').textContent = '';
              } catch (e) { $('err').textContent = e.message; }
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
