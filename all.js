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

    // 清除舊事件
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

// 初始化 Google Identity Services
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

                // 儲存 token 與過期時間 (預設 1 小時內)
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

    // 檢查是否有尚未過期的 token
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

// 讀取特定 Tab 資料
async function getSheetData(range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`;
    const result = await fetchGoogleAPI(url);
    return result.values || [];
}

// 寫入單筆新資料 (Append)
async function appendRow(range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED`;
    return await fetchGoogleAPI(url, {
        method: 'POST',
        body: JSON.stringify({ values: [values] })
    });
}

// 更新特定範圍資料
async function updateSheet(range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
    return await fetchGoogleAPI(url, {
        method: 'PUT',
        body: JSON.stringify({ values: values }) // values 為 2D array
    });
}

// 清空範圍資料
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
        // 取得使用者 Email
        const userInfoMeta = await fetchGoogleAPI('https://www.googleapis.com/oauth2/v1/userinfo?alt=json');

        showLoading('檢查系統權限...');
        const usersData = await getSheetData('Users!A2:C'); // 姓名, Email, 權限

        let hasAccess = false;
        for (const row of usersData) {
            if (row[1] && row[1].toLowerCase() === userInfoMeta.email.toLowerCase()) {
                currentUser.email = userInfoMeta.email;
                currentUser.name = row[0];
                currentUser.role = row[2];
                currentUser.picture = userInfoMeta.picture; // 儲存 Google 頭像
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

        // 如果發生 401/403 代表認證失效
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
        getSheetData('Menu!A2:E') // A名稱, B品名, C單價, D分類, E客製化標籤
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

    // 過濾今日有營業的菜單
    const todayMenu = appData.menu.filter(item => appData.todayRestaurants.includes(item.restaurant));

    if (todayMenu.length === 0) {
        listContainer.innerHTML = '<p class="text-muted">管理員尚未設定今日開放餐廳，或查無菜單。</p>';
        return;
    }

    todayMenu.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'menu-item card';

        // 渲染客製化標籤
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

        // Orders 欄位：[時間, Email, 姓名, 餐廳, 餐點, 金額, 備註, 已付金額(0), 付款狀態]
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
            document.getElementById(noteId).value = ''; // 清空輸入
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
    // 頁籤切換
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

    // 儲存今日餐廳
    document.getElementById('btn-save-today-restaurants').addEventListener('click', async () => {
        const checked = Array.from(document.querySelectorAll('.res-checkbox:checked')).map(cb => [cb.value]);

        showLoading('儲存設定中...');
        try {
            await clearSheet('TodayConfig!A2:A'); // 清空舊的
            if (checked.length > 0) {
                await updateSheet('TodayConfig!A2:A' + (1 + checked.length), checked);
            }

            // 重新載入
            await loadInitialData();
            hideLoading();
            customAlert('成功', '今日餐廳已更新！');
        } catch (e) {
            hideLoading();
            customAlert('錯誤', '設定失敗');
        }
    });

    // 清空訂單
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

    // 重新整理訂單 (管理員端)
    document.getElementById('btn-refresh-orders').addEventListener('click', () => {
        loadOrdersData();
    });

    // 重新整理大家的訂單 (前台端)
    document.getElementById('btn-refresh-public-orders').addEventListener('click', () => {
        loadPublicOrders();
    });

    // 登出邏輯
    document.getElementById('btn-logout').addEventListener('click', () => {
        localStorage.removeItem('gapi_access_token');
        localStorage.removeItem('gapi_token_exp');
        location.reload(); // 重新整理頁面是最乾淨的登出方式
    });
}

function loadAdminData() {
    // 渲染所有餐廳供勾選
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

// 拉取並渲染前台公開訂單與彙整
async function loadPublicOrders() {
    const tbody = document.getElementById('public-orders-tbody');
    const summaryTbody = document.getElementById('public-summary-tbody');

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">載入中...</td></tr>';
    summaryTbody.innerHTML = '<tr><td colspan="3" style="text-align:center">載入中...</td></tr>';

    try {
        const rawOrders = await getSheetData('Orders!A2:G'); // A時間, BEmail, C姓名, D餐廳, E餐點, F金額, G備註
        tbody.innerHTML = '';
        summaryTbody.innerHTML = '';

        if (rawOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">目前還沒有人點餐</td></tr>';
            summaryTbody.innerHTML = '<tr><td colspan="3" style="text-align:center">無資料</td></tr>';
            return;
        }

        const summary = {}; // 用於統計每人金額： { "姓名": { count: 0, total: 0 } }

        rawOrders.forEach(row => {
            const name = row[2] || '匿名';
            const restaurant = row[3] || '';
            const itemName = row[4] || '';
            const price = parseInt(row[5]) || 0;
            const note = row[6] ? `(${row[6]})` : '';

            // 1. 渲染明細表
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${name}</td>
                <td>${restaurant}</td>
                <td>${itemName}</td>
                <td class="text-muted">${note}</td>
                <td>$${price}</td>
            `;
            tbody.appendChild(tr);

            // 2. 統計彙整資料
            if (!summary[name]) {
                summary[name] = { count: 0, total: 0 };
            }
            summary[name].count += 1;
            summary[name].total += price;
        });

        // 3. 渲染彙整表
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
            rowIndex: idx + 2, // Excel 是 1-indexed，且資料從 A2 開始
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

// 宣染帳務表格 (依人彙整)
function renderAdminOrdersTable() {
    const tbody = document.getElementById('admin-orders-tbody');
    tbody.innerHTML = '';

    if (appData.orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">目前還沒有人點餐</td></tr>';
        return;
    }

    // 依 Email 彙整資料
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

// 更新該使用者的總帳務 (分配至各訂單列)
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

    // 取出今天有出現的訂單店家
    const orderRestaurants = [...new Set(appData.orders.map(o => o.restaurant))];

    if (orderRestaurants.length === 0) {
        container.innerHTML = '<p class="text-muted">尚無訂單，無法生成資料。</p>';
        return;
    }

    orderRestaurants.forEach(res => {
        // 取得過往 localStorage 紀錄
        const localUid = localStorage.getItem(`inv_uid_${res}`) || '';
        const localTitle = localStorage.getItem(`inv_title_${res}`) || '';

        const card = document.createElement('div');
        card.className = 'copy-restaurant-card';
        card.innerHTML = `
            <h4>${res}</h4>
            <div class="copy-meta">
                <label class="checkbox-label">
                    <input type="checkbox" id="need-utensil-${res}"> 需要餐具
                </label>
                <label class="checkbox-label">
                    <input type="checkbox" id="need-invoice-${res}" onchange="toggleInvoice('${res}')"> 需要發票
                </label>
            </div>
            <div class="invoice-fields hidden mt-1" id="inv-fields-${res}">
                <input type="text" id="uid-${res}" placeholder="統一編號" value="${localUid}">
                <input type="text" id="title-${res}" placeholder="公司抬頭" value="${localTitle}">
                <button class="btn-sm btn-outline" onclick="saveInvoiceData('${res}')">記住我</button>
            </div>
            <button class="btn btn-primary mt-1" onclick="generateAndCopyText('${res}')">一鍵複製 ${res} 訂單</button>
        `;
        container.appendChild(card);
    });
}

// 顯示發票欄位
window.toggleInvoice = function (res) {
    const chk = document.getElementById(`need-invoice-${res}`).checked;
    if (chk) {
        document.getElementById(`inv-fields-${res}`).classList.remove('hidden');
    } else {
        document.getElementById(`inv-fields-${res}`).classList.add('hidden');
    }
};

window.saveInvoiceData = function (res) {
    const uid = document.getElementById(`uid-${res}`).value;
    const title = document.getElementById(`title-${res}`).value;
    localStorage.setItem(`inv_uid_${res}`, uid);
    localStorage.setItem(`inv_title_${res}`, title);
    customAlert('成功', '統編抬頭已記錄在瀏覽器中！');
};

// 產生字串並放入剪貼簿
window.generateAndCopyText = function (targetRes) {
    // 篩選該餐廳訂單
    const targetOrders = appData.orders.filter(o => o.restaurant === targetRes);

    let totalQty = 0;
    let totalPrice = 0;
    let orderTextList = [];

    targetOrders.forEach((order, idx) => {
        totalQty++;
        totalPrice += order.price;
        let noteStr = order.note ? ` (備註：${order.note})` : '';
        orderTextList.push(`${idx + 1}. ${order.itemName} - ${order.name}${noteStr}`);
    });

    let resultString = `【${targetRes}】\n` + orderTextList.join('\n');
    resultString += `\n-- 共 ${totalQty} 份，總計 $${totalPrice} 元 --\n`;

    // 附加統一設定
    const needUtensil = document.getElementById(`need-utensil-${targetRes}`).checked;
    const needInvoice = document.getElementById(`need-invoice-${targetRes}`).checked;

    let bottomNotes = [];
    if (needUtensil) bottomNotes.push('請提供餐具');
    else bottomNotes.push('我們不需要餐具');

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

    // 複製到剪貼簿功能
    navigator.clipboard.writeText(resultString).then(() => {
        customAlert('複製成功', '文字已複製至剪貼簿，可以直接到 LINE 貼上！\n\n' + resultString.substring(0, 50) + '...');
    }).catch(err => {
        console.error(err);
        customAlert('複製失敗', '請確認瀏覽器有無剪貼簿權限');
    });
};
