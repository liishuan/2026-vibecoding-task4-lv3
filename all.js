// ==========================================
// 1. 全域設定區 (請在此填入您的憑證)
// ==========================================
const CLIENT_ID = '215959288600-q50d4lm7k6dcdankcnnqebscdba72vdj.apps.googleusercontent.com';
const SPREADSHEET_ID = '1ZwdUgCGCUqAFpwJCcMNXSKaGyM12dEdBfUQb7Kt7aQ0';

// Google API 權限範圍
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid';

// 全域狀態表
let accessToken = null;
let currentUser = { email: '', name: '', role: '', picture: '' };
let appData = {
    todayRestaurants: [],
    menu: [],
    orders: []
};

// ==========================================
// 2. DOM 元素與畫面控制
// ==========================================
const views = {
    login: document.getElementById('view-login'),
    unauthorized: document.getElementById('view-unauthorized'),
    ordering: document.getElementById('view-ordering'),
    admin: document.getElementById('view-admin')
};

function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
    }
}

function showLoading(textText = '資料載入中...') {
    document.getElementById('loading-text').innerText = textText;
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function updateUserInfoDisplay() {
    document.getElementById('user-info').classList.remove('hidden');
    document.getElementById('user-name-display').innerText = currentUser.name;

    const avatarImg = document.getElementById('user-avatar');
    if (currentUser.picture) {
        avatarImg.src = currentUser.picture;
    } else {
        avatarImg.src = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    }

    const roleBadge = document.getElementById('user-role-badge');
    roleBadge.innerText = currentUser.role;
    if (currentUser.role === '管理員') {
        roleBadge.classList.add('admin');
        document.getElementById('btn-switch-admin').classList.remove('hidden');
    } else {
        roleBadge.classList.remove('admin');
        document.getElementById('btn-switch-admin').classList.add('hidden');
    }
}

// ==========================================
// 3. 自訂 Modal 工具
// ==========================================
function customConfirm(title, message, onConfirm) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerText = message;

    const btnCancel = document.getElementById('modal-btn-cancel');
    const btnConfirm = document.getElementById('modal-btn-confirm');

    btnCancel.classList.remove('hidden');

    btnCancel.onclick = () => {
        modal.classList.add('hidden');
    };
    btnConfirm.onclick = () => {
        modal.classList.add('hidden');
        onConfirm();
    };

    modal.classList.remove('hidden');
}

function customAlert(title, message) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerText = message;

    const btnCancel = document.getElementById('modal-btn-cancel');
    const btnConfirm = document.getElementById('modal-btn-confirm');

    btnCancel.classList.add('hidden');

    btnConfirm.onclick = () => {
        modal.classList.add('hidden');
    };

    modal.classList.remove('hidden');
}

// ==========================================
// 4. Google API 與資料庫封裝
// ==========================================
let tokenClient;

window.onload = function () {
    if (CLIENT_ID === '請在此填入您的Google Client ID') {
        customAlert('設定錯誤', '請先在 all.js 中填入您的 CLIENT_ID 與 SPREADSHEET_ID');
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                accessToken = tokenResponse.access_token;
                const expiresInMs = (tokenResponse.expires_in || 3599) * 1000;
                localStorage.setItem('gapi_access_token', accessToken);
                localStorage.setItem('gapi_token_exp', Date.now() + expiresInMs);
                await proceedLoginFlow();
            }
        },
    });

    document.getElementById('btn-google-login').addEventListener('click', () => {
        tokenClient.requestAccessToken();
    });

    bindEvents();

    const savedToken = localStorage.getItem('gapi_access_token');
    const tokenExp = localStorage.getItem('gapi_token_exp');
    if (savedToken && tokenExp && Date.now() < parseInt(tokenExp)) {
        accessToken = savedToken;
        proceedLoginFlow();
    }
};

async function fetchGoogleAPI(url, options = {}) {
    if (!accessToken) throw new Error('No access token');
    const defaultHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    };
    const res = await fetch(url, {
        ...options,
        headers: { ...defaultHeaders, ...(options.headers || {}) }
    });
    if (!res.ok) {
        throw new Error(`[${res.status}] API Error: ${await res.text()}`);
    }
    return res.json();
}

async function getSheetData(range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`;
    const result = await fetchGoogleAPI(url);
    return result.values || [];
}

async function appendRow(range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED`;
    return await fetchGoogleAPI(url, {
        method: 'POST',
        body: JSON.stringify({ values: [values] })
    });
}

async function updateSheet(range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
    return await fetchGoogleAPI(url, {
        method: 'PUT',
        body: JSON.stringify({ values: values })
    });
}

async function clearSheet(range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:clear`;
    return await fetchGoogleAPI(url, { method: 'POST' });
}

// ==========================================
// 5. 核心登入流程與拉取資料
// ==========================================
async function proceedLoginFlow() {
    showLoading('取得身分驗證資訊...');
    try {
        const userInfoMeta = await fetchGoogleAPI('https://www.googleapis.com/oauth2/v1/userinfo?alt=json');
        showLoading('檢查系統權限...');
        const usersData = await getSheetData('Users!A2:C');

        let hasAccess = false;
        for (const row of usersData) {
            if (row[1] && row[1].toLowerCase() === userInfoMeta.email.toLowerCase()) {
                currentUser.email = userInfoMeta.email;
                currentUser.name = row[0];
                currentUser.role = row[2];
                currentUser.picture = userInfoMeta.picture;
                hasAccess = true;
                break;
            }
        }

        if (!hasAccess) {
            hideLoading();
            switchView('unauthorized');
            return;
        }

        updateUserInfoDisplay();
        await loadInitialData();

        hideLoading();
        switchView('ordering');

    } catch (error) {
        console.error('Login Flow Error:', error);
        hideLoading();
        const errorMsg = error.message || '未知錯誤';

        if (errorMsg.includes('[401]') || errorMsg.includes('[403]')) {
            localStorage.removeItem('gapi_access_token');
            localStorage.removeItem('gapi_token_exp');
            switchView('login');
            customAlert('登入授權失敗', `Google 回傳錯誤：\n${errorMsg}\n\n請嘗試重新登入，或檢查試算表是否已開啟權限給此 API 專案。`);
        } else {
            customAlert('發生錯誤', `登入或拉取資料失敗：\n${errorMsg}`);
            switchView('login');
        }
    }
}

async function loadInitialData() {
    showLoading('載入菜單...');
    const [todayConfData, menuData] = await Promise.all([
        getSheetData('TodayConfig!A2:A'),
        getSheetData('Menu!A2:E')
    ]);

    appData.todayRestaurants = todayConfData.map(r => r[0]).filter(Boolean);
    appData.menu = menuData.map(row => ({
        restaurant: row[0],
        name: row[1],
        price: parseInt(row[2]) || 0,
        category: row[3],
        options: row[4] ? row[4].split(',').map(s => s.trim()).filter(Boolean) : []
    }));

    renderOrderingView();
    await loadPublicOrders();
}

// ==========================================
// 6. 一般用戶點餐邏輯
// ==========================================
function renderOrderingView() {
    document.getElementById('today-restaurants-display').innerText =
        appData.todayRestaurants.length > 0 ? appData.todayRestaurants.join('、') : '今日無開放餐廳';

    const listContainer = document.getElementById('menu-list');
    listContainer.innerHTML = '';

    const todayMenu = appData.menu.filter(item => appData.todayRestaurants.includes(item.restaurant));

    if (todayMenu.length === 0) {
        listContainer.innerHTML = '<p class="text-muted">管理員尚未設定今日開放餐廳，或查無菜單。</p>';
        return;
    }

    todayMenu.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'menu-item card';

        let pillsHtml = '';
        if (item.options.length > 0) {
            pillsHtml = `<div class="custom-options">` + item.options.map(opt => `<span class="pill-tag" onclick="addNote('${index}', '${opt}')">${opt}</span>`).join('') + `</div>`;
        }

        div.innerHTML = `
            <div class="menu-item-store">${item.restaurant}</div>
            <div class="menu-item-header">
                <div class="menu-item-title">${item.name}</div>
                <div class="menu-item-price">$${item.price}</div>
            </div>
            ${pillsHtml}
            <div class="form-group mt-1">
                <input type="text" id="note-${index}" class="form-input" placeholder="有什麼備註嗎？(如：不要蔥)">
            </div>
            <button class="btn btn-primary" style="width:100%" onclick="submitOrder('${item.restaurant}', '${item.name}', ${item.price}, 'note-${index}')">加入訂單</button>
        `;
        listContainer.appendChild(div);
    });
}

function addNote(index, text) {
    const input = document.getElementById('note-' + index);
    if (input.value) {
        input.value += `, ${text}`;
    } else {
        input.value = text;
    }
}

async function submitOrder(restaurant, itemName, price, noteId) {
    const note = document.getElementById(noteId).value.trim();
    const confirmMsg = `確定要送出以下訂單嗎？\n\n【${restaurant}】${itemName}\n金額：$${price}\n備註：${note || '無'}`;

    customConfirm('確認送出?', confirmMsg, async () => {
        showLoading('送出訂單中...');
        const now = new Date();
        const timeString = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const rowData = [
            timeString,
            currentUser.email,
            currentUser.name,
            restaurant,
            itemName,
            price,
            note,
            0,
            '未付(全額代墊)'
        ];

        try {
            await appendRow('Orders!A:I', rowData);
            hideLoading();
            document.getElementById(noteId).value = '';
            customAlert('成功', '✅ 訂單已送出！');
            loadPublicOrders();
        } catch (e) {
            hideLoading();
            customAlert('錯誤', '送出失敗，請稍後再試。');
        }
    });
}

// ==========================================
// 7. 管理員邏輯
// ==========================================
function bindEvents() {
    document.getElementById('btn-switch-admin').addEventListener('click', () => {
        document.getElementById('btn-switch-admin').classList.add('hidden');
        document.getElementById('btn-switch-user').classList.remove('hidden');
        switchView('admin');
        loadAdminData();
    });

    document.getElementById('btn-switch-user').addEventListener('click', () => {
        document.getElementById('btn-switch-user').classList.add('hidden');
        document.getElementById('btn-switch-admin').classList.remove('hidden');
        switchView('ordering');
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));

            e.target.classList.add('active');
            document.getElementById(e.target.dataset.target).classList.remove('hidden');

            if (e.target.dataset.target === 'admin-orders') {
                loadOrdersData();
            }
        });
    });

    document.getElementById('btn-save-today-restaurants').addEventListener('click', async () => {
        const checked = Array.from(document.querySelectorAll('.res-checkbox:checked')).map(cb => [cb.value]);

        showLoading('儲存設定中...');
        try {
            await clearSheet('TodayConfig!A2:A');
            if (checked.length > 0) {
                await updateSheet('TodayConfig!A2:A' + (1 + checked.length), checked);
            }
            await loadInitialData();
            hideLoading();
            customAlert('成功', '今日餐廳已更新！');
        } catch (e) {
            hideLoading();
            customAlert('錯誤', '設定失敗');
        }
    });

    document.getElementById('btn-clear-orders').addEventListener('click', () => {
        customConfirm('⚠️ 嚴重警告', '確定要清空今天「所有」的訂單嗎？（標題列會保留，其餘刪除，且無法復原！）', async () => {
            showLoading('清空中...');
            try {
                await clearSheet('Orders!A2:I');
                hideLoading();
                customAlert('成功', '所有訂單資料已清空。');
                loadOrdersData();
            } catch (e) {
                hideLoading();
                customAlert('錯誤', '清空失敗');
            }
        });
    });

    document.getElementById('btn-refresh-orders').addEventListener('click', () => {
        loadOrdersData();
    });

    document.getElementById('btn-refresh-public-orders').addEventListener('click', () => {
        loadPublicOrders();
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
        localStorage.removeItem('gapi_access_token');
        localStorage.removeItem('gapi_token_exp');
        location.reload();
    });
}

function loadAdminData() {
    const allRestaurants = [...new Set(appData.menu.map(m => m.restaurant))];
    const container = document.getElementById('restaurant-checkboxes');
    container.innerHTML = '';

    allRestaurants.forEach(res => {
        const isChecked = appData.todayRestaurants.includes(res) ? 'checked' : '';
        container.innerHTML += `
            <label class="checkbox-label">
                <input type="checkbox" class="res-checkbox" value="${res}" ${isChecked}> ${res}
            </label>
        `;
    });
}

async function loadPublicOrders() {
    const tbody = document.getElementById('public-orders-tbody');
    const summaryTbody = document.getElementById('public-summary-tbody');

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">載入中...</td></tr>';
    summaryTbody.innerHTML = '<tr><td colspan="3" style="text-align:center">載入中...</td></tr>';

    try {
        const rawOrders = await getSheetData('Orders!A2:G');
        tbody.innerHTML = '';
        summaryTbody.innerHTML = '';

        if (rawOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">目前還沒有人點餐</td></tr>';
            summaryTbody.innerHTML = '<tr><td colspan="3" style="text-align:center">無資料</td></tr>';
            return;
        }

        const summary = {};

        rawOrders.forEach(row => {
            const name = row[2] || '匿名';
            const restaurant = row[3] || '';
            const itemName = row[4] || '';
            const price = parseInt(row[5]) || 0;
            const note = row[6] ? `(${row[6]})` : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${name}</td>
                <td>${restaurant}</td>
                <td>${itemName}</td>
                <td class="text-muted">${note}</td>
                <td>$${price}</td>
            `;
            tbody.appendChild(tr);

            if (!summary[name]) {
                summary[name] = { count: 0, total: 0 };
            }
            summary[name].count += 1;
            summary[name].total += price;
        });

        Object.keys(summary).sort().forEach(name => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${name}</strong></td>
                <td>${summary[name].count} 份</td>
                <td class="text-primary" style="font-weight: 700;">$${summary[name].total}</td>
            `;
            summaryTbody.appendChild(tr);
        });

    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red">載入失敗</td></tr>';
        summaryTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:red">載入失敗</td></tr>';
        console.error('拉取公開訂單失敗：', e);
    }
}

// ==========================================
// 8. 帳務與複製訂單核心邏輯
// ==========================================
async function loadOrdersData() {
    showLoading('取得最新訂單...');
    try {
        const rawOrders = await getSheetData('Orders!A2:I');
        appData.orders = rawOrders.map((row, idx) => ({
            rowIndex: idx + 2,
            time: row[0] || '',
            email: row[1] || '',
            name: row[2] || '',
            restaurant: row[3] || '',
            itemName: row[4] || '',
            price: parseInt(row[5]) || 0,
            note: row[6] || '',
            paidValue: parseInt(row[7]) || 0,
            status: row[8] || '未付(全額代墊)'
        }));

        renderAdminOrdersTable();
        renderCopySection();
        hideLoading();
    } catch (e) {
        hideLoading();
        customAlert('拉取失敗', '無法取得最新訂單');
        console.error(e);
    }
}

function renderAdminOrdersTable() {
    const tbody = document.getElementById('admin-orders-tbody');
    tbody.innerHTML = '';

    if (appData.orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">目前還沒有人點餐</td></tr>';
        return;
    }

    const personSummary = {};
    appData.orders.forEach(order => {
        const key = order.email;
        if (!personSummary[key]) {
            personSummary[key] = {
                name: order.name,
                email: order.email,
                items: [],
                totalPrice: 0,
                totalPaid: 0,
                rowIndices: []
            };
        }
        personSummary[key].items.push(`${order.restaurant}-${order.itemName}`);
        personSummary[key].totalPrice += order.price;
        personSummary[key].totalPaid += order.paidValue;
        personSummary[key].rowIndices.push(order.rowIndex);
    });

    Object.values(personSummary).forEach(person => {
        const tr = document.createElement('tr');

        let status = '';
        let statusClass = 'status-unpaid';
        if (person.totalPaid === 0) {
            status = `未付 ($${person.totalPrice})`;
        } else if (person.totalPaid >= person.totalPrice) {
            status = `✅ 全額付清`;
            statusClass = 'status-paid';
        } else {
            status = `⚠️ 尚欠 $${person.totalPrice - person.totalPaid}`;
            statusClass = 'status-partial';
        }

        const itemsDisplay = person.items.join(', ');

        tr.innerHTML = `
            <td>${person.name}</td>
            <td class="text-sm text-muted">${person.email}</td>
            <td class="text-sm">${itemsDisplay}</td>
            <td>$${person.totalPrice}</td>
            <td>
                <input type="number" class="form-input" style="width: 80px; margin:0;" value="${person.totalPaid}" id="person-paid-${person.email.replace(/[@.]/g, '_')}">
            </td>
            <td class="${statusClass}">${status}</td>
            <td>
                <button class="btn-sm btn-primary" onclick="updatePersonFinance('${person.email}', ${person.totalPrice})">更新</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function updatePersonFinance(email, totalPrice) {
    const inputId = `person-paid-${email.replace(/[@.]/g, '_')}`;
    let newTotalPaid = parseInt(document.getElementById(inputId).value) || 0;

    if (newTotalPaid < 0) newTotalPaid = 0;
    if (newTotalPaid > totalPrice) newTotalPaid = totalPrice;

    const userOrders = appData.orders.filter(o => o.email === email);
    if (userOrders.length === 0) return;

    showLoading(`分配 ${userOrders[0].name} 的收款金額...`);

    let remaining = newTotalPaid;
    try {
        const promises = userOrders.map(order => {
            const thisRowPaid = Math.min(order.price, remaining);
            remaining -= thisRowPaid;

            let rowStatus = '';
            if (thisRowPaid === 0) rowStatus = `未付(全額代墊$${order.price})`;
            else if (thisRowPaid === order.price) rowStatus = `✅ 全額付清`;
            else rowStatus = `⚠️ 部分付款 (尚欠代墊$${order.price - thisRowPaid})`;

            return updateSheet(`Orders!H${order.rowIndex}:I${order.rowIndex}`, [[thisRowPaid, rowStatus]]);
        });

        await Promise.all(promises);
        hideLoading();
        customAlert('成功', `已更新 ${userOrders[0].name} 的帳務狀態。`);
        loadOrdersData();
    } catch (e) {
        hideLoading();
        customAlert('錯誤', '更新失敗：' + e.message);
    }
}

// 渲染「一鍵複製」的店家群組與設定區
function renderCopySection() {
    const container = document.getElementById('copy-order-config');
    container.innerHTML = '';

    const orderRestaurants = [...new Set(appData.orders.map(o => o.restaurant))];

    if (orderRestaurants.length === 0) {
        container.innerHTML = '<p class="text-muted">尚無訂單，無法生成資料。</p>';
        return;
    }

    orderRestaurants.forEach(res => {
        // 取得 localStorage 的發票與外送資訊
        const localUid = localStorage.getItem(`inv_uid_${res}`) || '';
        const localTitle = localStorage.getItem(`inv_title_${res}`) || '';
        const localDelName = localStorage.getItem(`del_name_${res}`) || '';
        const localDelPhone = localStorage.getItem(`del_phone_${res}`) || '';
        const localDelAddr = localStorage.getItem(`del_addr_${res}`) || '';

        const card = document.createElement('div');
        card.className = 'copy-restaurant-card';
        card.innerHTML = `
            <div class="copy-card-header">
                <h4>${res}</h4>
                <button class="btn btn-primary btn-sm" onclick="generateAndCopyText('${res}', this)">
                    📋 一鍵複製訂單
                </button>
            </div>
            
            <div class="copy-meta">
                <label class="checkbox-label">
                    <input type="checkbox" id="need-utensil-${res}"> 需要餐具
                </label>
                <label class="checkbox-label">
                    <input type="checkbox" id="need-invoice-${res}" onchange="toggleInvoice('${res}')"> 需要發票
                </label>
                <label class="checkbox-label">
                    <input type="checkbox" id="need-delivery-${res}" onchange="toggleDelivery('${res}')"> 需要外送
                </label>
            </div>
            
            <div class="invoice-fields hidden mt-3" id="inv-fields-${res}">
                <strong class="text-sm" style="color: var(--primary-color);">🧾 發票資訊</strong>
                <input type="text" id="uid-${res}" class="form-input" placeholder="統一編號" value="${localUid}">
                <input type="text" id="title-${res}" class="form-input" placeholder="公司抬頭" value="${localTitle}">
                <label class="checkbox-label text-sm" style="margin-top: 4px;">
                    <input type="checkbox" onchange="saveInvoiceData('${res}')"> 記住發票資訊
                </label>
            </div>

            <div class="invoice-fields hidden mt-3" id="del-fields-${res}">
                <strong class="text-sm" style="color: var(--primary-color);">🛵 外送資訊</strong>
                <input type="text" id="del-name-${res}" class="form-input" placeholder="聯絡人" value="${localDelName}">
                <input type="text" id="del-phone-${res}" class="form-input" placeholder="聯絡電話" value="${localDelPhone}">
                <input type="text" id="del-addr-${res}" class="form-input" placeholder="外送地址" value="${localDelAddr}">
                <label class="checkbox-label text-sm" style="margin-top: 4px;">
                    <input type="checkbox" onchange="saveDeliveryData('${res}')"> 記住外送資訊
                </label>
            </div>
        `;
        container.appendChild(card);
    });
}

// 控制發票區塊展開
window.toggleInvoice = function (res) {
    const chk = document.getElementById(`need-invoice-${res}`).checked;
    if (chk) {
        document.getElementById(`inv-fields-${res}`).classList.remove('hidden');
    } else {
        document.getElementById(`inv-fields-${res}`).classList.add('hidden');
    }
};

// 控制外送區塊展開
window.toggleDelivery = function (res) {
    const chk = document.getElementById(`need-delivery-${res}`).checked;
    if (chk) {
        document.getElementById(`del-fields-${res}`).classList.remove('hidden');
    } else {
        document.getElementById(`del-fields-${res}`).classList.add('hidden');
    }
};

// 儲存發票資訊 (移除干擾的 Alert)
window.saveInvoiceData = function (res) {
    const uid = document.getElementById(`uid-${res}`).value;
    const title = document.getElementById(`title-${res}`).value;
    localStorage.setItem(`inv_uid_${res}`, uid);
    localStorage.setItem(`inv_title_${res}`, title);
};

// 儲存外送資訊 (移除干擾的 Alert)
window.saveDeliveryData = function (res) {
    const name = document.getElementById(`del-name-${res}`).value;
    const phone = document.getElementById(`del-phone-${res}`).value;
    const addr = document.getElementById(`del-addr-${res}`).value;
    localStorage.setItem(`del_name_${res}`, name);
    localStorage.setItem(`del_phone_${res}`, phone);
    localStorage.setItem(`del_addr_${res}`, addr);
};

// 一鍵複製核心邏輯
window.generateAndCopyText = function (targetRes, btnElement) {
    const targetOrders = appData.orders.filter(o => o.restaurant === targetRes);

    let totalQty = 0;
    let totalPrice = 0;

    // 1. 群組化：相同餐點與備註的訂單合併
    const groupedOrders = {};

    targetOrders.forEach(order => {
        totalQty++;
        totalPrice += order.price;

        // 組合 Key 來判斷項目是否完全相同
        const key = `${order.itemName}_${order.note}`;

        if (!groupedOrders[key]) {
            groupedOrders[key] = {
                itemName: order.itemName,
                note: order.note,
                qty: 0
            };
        }
        groupedOrders[key].qty++;
    });

    // 2. 產出聚合後的清單文字
    let orderTextList = [];
    Object.values(groupedOrders).forEach(item => {
        let noteStr = item.note ? ` (備註：${item.note})` : '';
        orderTextList.push(`${item.itemName}${noteStr} ${item.qty}份`);
    });

    let resultString = `【${targetRes}】\n` + orderTextList.join('\n');
    resultString += `\n-- 共 ${totalQty} 份，總計 $${totalPrice} 元 --\n`;

    // 3. 處理附註與外送資訊
    const needUtensil = document.getElementById(`need-utensil-${targetRes}`).checked;
    const needInvoice = document.getElementById(`need-invoice-${targetRes}`).checked;
    const needDelivery = document.getElementById(`need-delivery-${targetRes}`).checked;

    let bottomNotes = [];
    if (needUtensil) bottomNotes.push('需要餐具');
    else bottomNotes.push('不需要餐具');

    if (needInvoice) {
        const uid = document.getElementById(`uid-${targetRes}`).value;
        const title = document.getElementById(`title-${targetRes}`).value;
        if (uid || title) {
            bottomNotes.push(`需開立發票 (統編: ${uid}, 抬頭: ${title})`);
        } else {
            bottomNotes.push('需開立發票');
        }
    }

    if (bottomNotes.length > 0) {
        resultString += `※附註：${bottomNotes.join('、')}\n`;
    }

    if (needDelivery) {
        const dName = document.getElementById(`del-name-${targetRes}`).value;
        const dPhone = document.getElementById(`del-phone-${targetRes}`).value;
        const dAddr = document.getElementById(`del-addr-${targetRes}`).value;
        resultString += `\n外送資訊\n聯絡人：${dName}\n聯絡電話：${dPhone}\n外送地址：${dAddr}\n`;
    }

    // 4. 寫入剪貼簿與按鈕微互動 (移除彈出視窗)
    navigator.clipboard.writeText(resultString).then(() => {
        const originalHtml = btnElement.innerHTML;

        // 變更按鈕為成功狀態
        btnElement.innerHTML = '✅ 已複製！';
        btnElement.style.backgroundColor = '#2D6A4F';
        btnElement.style.borderColor = '#2D6A4F';

        // 2秒後恢復原狀
        setTimeout(() => {
            btnElement.innerHTML = originalHtml;
            btnElement.style.backgroundColor = '';
            btnElement.style.borderColor = '';
        }, 2000);

    }).catch(err => {
        console.error(err);
        customAlert('複製失敗', '請確認瀏覽器有無剪貼簿權限');
    });
};