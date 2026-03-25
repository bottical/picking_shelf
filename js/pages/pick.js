// Pick Mode Logic (Non-module)
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const listIdInput = document.getElementById('listIdInput');
        const pickTable = document.getElementById('pickTable');
        const currentListTitle = document.getElementById('currentListTitle');
        const sessionDisplay = document.getElementById('sessionDisplay');

        let currentListId = null;

        const stateMgr = new StateManager(
            (state) => render(state),
            (user) => {
                if (user) {
                    sessionDisplay.textContent = `USER: ${user.email}`;
                } else {
                    window.location.href = 'index.html';
                }
            }
        );

        const loadList = (id) => {
            if (!stateMgr.state.pickLists?.[id]) {
                new Audio('error.mp3').play().catch(e => console.log(e));
                return alert("ピッキングNo.が見つかりません！");
            }
            currentListId = id;
            listIdInput.value = '';

            const lines = stateMgr.state.pickLists[id];
            
            const allCompleted = lines.length > 0 && lines.every(l => l.status === 'DONE');
            if (allCompleted) {
                new Audio('error.mp3').play().catch(e => console.log(e));
            } else {
                new Audio('start.mp3').play().catch(e => console.log(e));
            }

            const newActivePick = {};
            lines.forEach(line => {
                if (line.status === 'DONE') return;
                const entry = Object.entries(stateMgr.state.slots || {}).find(([k, v]) => {
                    const skus = v.skus || (v.sku ? [v.sku] : []);
                    return skus.includes(line.jan);
                });
                
                const slotKey = entry ? entry[0] : 'UNALLOCATED';
                if (!newActivePick[slotKey]) {
                    newActivePick[slotKey] = { totalQty: 0, pendingQty: 0, skus: [], pickNo: id };
                }
                newActivePick[slotKey].totalQty += line.qty;
                if (line.status !== 'DONE') {
                    newActivePick[slotKey].pendingQty += line.qty;
                }
                if (!newActivePick[slotKey].skus.includes(line.jan)) {
                    newActivePick[slotKey].skus.push(line.jan);
                }
            });

            stateMgr.update({
                activePick: newActivePick,
                currentPickingNo: id,
                mode: 'PICK'
            });
        };

        const render = (state) => {
            // Auto-sync currentPickingNo from global state
            if (state.currentPickingNo && state.currentPickingNo !== currentListId) {
                currentListId = state.currentPickingNo;
            } else if (!state.currentPickingNo) {
                currentListId = null;
                currentListTitle.textContent = `ピッキングNo.を入力してください`;
            }

            pickTable.innerHTML = '';
            if (!currentListId || !state.pickLists?.[currentListId]) {
                const msg = !currentListId ? "ピッキングNo.を入力してください" : "データが見つかりません";
                pickTable.innerHTML = `<tr><td colspan="5" style="padding:3rem; text-align:center; color:var(--text-muted);">${msg}</td></tr>`;
                return;
            }

            const lines = state.pickLists[currentListId];
            const allCompleted = lines.length > 0 && lines.every(l => l.status === 'DONE');
            if (allCompleted) {
                currentListTitle.innerHTML = `<span style="color: red;">完了済み：${currentListId}</span>`;
            } else {
                currentListTitle.textContent = `ピッキング中: ${currentListId}`;
            }
            lines.forEach((line, idx) => {
                const entry = Object.entries(state.slots || {}).find(([k, v]) => {
                    const skus = v.skus || (v.sku ? [v.sku] : []);
                    return skus.includes(line.jan);
                });
                const location = entry ? entry[0] : "その他";
                const subId = entry ? location.split('-')[1] : null;

                const tr = document.createElement('tr');
                tr.style.opacity = line.status === 'DONE' ? 0.5 : 1;
                if (line.status === 'DONE') tr.style.background = '#f8fafc';

                tr.innerHTML = `
                    <td style="padding:1rem; font-weight:600;">...${line.jan.slice(-4)}</td>
                    <td style="padding:1rem; font-size:1.25rem; font-weight:800;">${line.qty}</td>
                    <td style="padding:1rem;">
                        <span style="padding:0.25rem 0.75rem; border-radius:4px; font-weight:800; color:white; background:${entry ? `hsl(${(subId - 1) * 60 + 200}, 70%, 50%)` : '#eab308'}">
                            ${location}
                        </span>
                    </td>
                    <td style="padding:1rem;">
                        <span class="status-badge ${line.status === 'DONE' ? 'status-done' : 'status-pending'}">
                            ${line.status === 'DONE' ? '完了' : '未完了'}
                        </span>
                    </td>
                    <td style="padding:1rem;">
                        ${line.status === 'PENDING'
                        ? `<button class="btn btn-primary btn-sm complete-btn" data-index="${idx}">完了</button>`
                        : '✅'}
                    </td>
                `;
                pickTable.appendChild(tr);
            });

            document.querySelectorAll('.complete-btn').forEach(btn => {
                btn.onclick = () => {
                    const idx = btn.getAttribute('data-index');
                    completeLine(idx);
                };
            });
        };

        const completeLine = (index) => {
            if (!currentListId) return;
            const lines = [...stateMgr.state.pickLists[currentListId]];
            const line = lines[index];
            if (line.status === 'DONE') return;

            line.status = 'DONE';

            const updates = {
                [`pickLists.${currentListId}`]: lines
            };

            const allDone = lines.every(l => l.status === 'DONE');

            if (allDone) {
                new Audio('complete.mp3').play().catch(e => console.log(e));
                updates.activePick = {};
            } else {
                const newActivePick = {};
                lines.forEach(l => {
                    const entry = Object.entries(stateMgr.state.slots || {}).find(([k, v]) => {
                        const skus = v.skus || (v.sku ? [v.sku] : []);
                        return skus.includes(l.jan);
                    });
                    const slotKey = entry ? entry[0] : 'UNALLOCATED';
                    if (!newActivePick[slotKey]) {
                        newActivePick[slotKey] = { totalQty: 0, pendingQty: 0, skus: [], pickNo: currentListId };
                    }
                    newActivePick[slotKey].totalQty += l.qty;
                    if (l.status !== 'DONE') {
                        newActivePick[slotKey].pendingQty += l.qty;
                    }
                    if (!newActivePick[slotKey].skus.includes(l.jan)) {
                        newActivePick[slotKey].skus.push(l.jan);
                    }
                });
                updates.activePick = newActivePick;
            }

            stateMgr.update(updates);
        };

        const createSampleList = () => {
            const filledSlots = Object.values(stateMgr.state.slots || {});
            const allSkus = [];
            filledSlots.forEach(slot => {
                const skus = slot.skus || (slot.sku ? [slot.sku] : []);
                allSkus.push(...skus);
            });
            if (allSkus.length === 0) return alert("商品が投入されていません！");

            const id = "LIST-" + Math.floor(Math.random() * 1000);
            const lines = [];
            for (let i = 0; i < 3; i++) {
                const sku = allSkus[Math.floor(Math.random() * allSkus.length)];
                lines.push({ jan: sku, qty: Math.floor(Math.random() * 5) + 1, status: 'PENDING' });
            }

            stateMgr.update({ [`pickLists.${id}`]: lines });
            alert(`リスト ${id} 作成完了`);
            loadList(id);
        };

        const forcePickMode = () => {
            stateMgr.update({ mode: 'PICK' });
            alert("モードを PICK に変更しました");
        };

        // UI Event Listeners
        listIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadList(listIdInput.value.trim());
        });

        document.getElementById('createSampleBtn').onclick = createSampleList;
        document.getElementById('forcePickBtn').onclick = forcePickMode;

        document.getElementById('resetPickingBtn').onclick = () => {
            if (!currentListId) return;
            stateMgr.update({
                currentPickingNo: firebase.firestore.FieldValue.delete(),
                activePick: {}, // Clear active targets on wall
                mode: 'INJECT'
            });
            alert("ピッキング作業をリセットしました");
        };

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                const page = link.getAttribute('data-page');
                window.location.href = page;
            });
        });
    });
})();
