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

        const updateUserSelectorUI = () => {
            const userSelect = document.getElementById('userSelect');
            if (userSelect) {
                userSelect.value = stateMgr.currentUserId;
                const uIdx = stateMgr.currentUserId.slice(-1);
                userSelect.style.borderColor = `var(--user${uIdx})`;
                userSelect.style.color = `var(--user${uIdx})`;
                userSelect.style.backgroundColor = `rgba(255, 255, 255, 0.05)`;
            }
        };

        const loadList = (id) => {
            if (!stateMgr.state.pickLists?.[id]) {
                AudioManager.playErrorSound();
                listIdInput.value = '';
                currentListTitle.innerHTML = `<span style="color: var(--danger);">エラー：見つかりません (${id})</span>`;
                pickTable.innerHTML = `<tr><td colspan="5" style="padding:3rem; text-align:center; color:var(--danger); font-size:1.2rem; font-weight:bold;">入力されたピッキングNo.「${id}」が存在しません。</td></tr>`;
                return;
            }
            listIdInput.value = '';

            const lines = stateMgr.state.pickLists[id];
            
            const allCompleted = lines.length > 0 && lines.every(l => l.status === 'DONE');
            if (allCompleted) {
                AudioManager.playErrorSound();
            } else {
                AudioManager.playStartSound();
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

            stateMgr.startPicking(id, newActivePick);
        };

        const render = (state) => {
            updateUserSelectorUI();
            const currentUserState = state.userStates?.[stateMgr.currentUserId] || {};
            const currentPickingNo = currentUserState.currentPickingNo;

            pickTable.innerHTML = '';
            if (!currentPickingNo || !state.pickLists?.[currentPickingNo]) {
                const msg = !currentPickingNo ? "ピッキングNo.を入力してください" : "データが見つかりません";
                pickTable.innerHTML = `<tr><td colspan="5" style="padding:3rem; text-align:center; color:var(--text-muted);">${msg}</td></tr>`;
                currentListTitle.textContent = `ピッキングNo.を入力してください`;
                return;
            }

            const lines = state.pickLists[currentPickingNo];
            const allCompleted = lines.length > 0 && lines.every(l => l.status === 'DONE');
            if (allCompleted) {
                currentListTitle.innerHTML = `<span style="color: red;">完了済み：${currentPickingNo}</span>`;
            } else {
                currentListTitle.innerHTML = `<span class="user-text-${stateMgr.currentUserId.slice(-1)}">【ユーザー${stateMgr.currentUserId.slice(-1)}】</span> ピッキング中: ${currentPickingNo}`;
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
                        ? `<button class="btn btn-primary btn-sm complete-btn user-bg-${stateMgr.currentUserId.slice(-1)}" data-index="${idx}">完了</button>`
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
            const currentUserState = stateMgr.state.userStates?.[stateMgr.currentUserId];
            const currentPickingNo = currentUserState?.currentPickingNo;
            if (!currentPickingNo) return;
            
            const lines = [...stateMgr.state.pickLists[currentPickingNo]];
            const line = lines[index];
            if (line.status === 'DONE') return;

            line.status = 'DONE';

            const updates = {
                [`pickLists.${currentPickingNo}`]: lines
            };

            const allDone = lines.every(l => l.status === 'DONE');

            if (allDone) {
                AudioManager.playCompleteSound();
                updates[`userStates.${stateMgr.currentUserId}.activePick`] = {};
            } else {
                const newActivePick = {};
                lines.forEach(l => {
                    const entry = Object.entries(stateMgr.state.slots || {}).find(([k, v]) => {
                        const skus = v.skus || (v.sku ? [v.sku] : []);
                        return skus.includes(l.jan);
                    });
                    const slotKey = entry ? entry[0] : 'UNALLOCATED';
                    if (!newActivePick[slotKey]) {
                        newActivePick[slotKey] = { totalQty: 0, pendingQty: 0, skus: [], pickNo: currentPickingNo };
                    }
                    newActivePick[slotKey].totalQty += l.qty;
                    if (l.status !== 'DONE') {
                        newActivePick[slotKey].pendingQty += l.qty;
                    }
                    if (!newActivePick[slotKey].skus.includes(l.jan)) {
                        newActivePick[slotKey].skus.push(l.jan);
                    }
                });
                updates[`userStates.${stateMgr.currentUserId}.activePick`] = newActivePick;
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
            const currentUserState = stateMgr.state.userStates?.[stateMgr.currentUserId];
            if (!currentUserState?.currentPickingNo) return;
            
            stateMgr.resetUserPick(stateMgr.currentUserId).then(() => {
                alert("ピッキング作業をリセットしました（未完了の進捗もクリアされました）");
            });
        };

        const userSelect = document.getElementById('userSelect');
        if (userSelect) {
            userSelect.addEventListener('change', (e) => {
                stateMgr.setCurrentUser(e.target.value);
            });
        }

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                const page = link.getAttribute('data-page');
                window.location.href = page;
            });
        });
    });
})();
