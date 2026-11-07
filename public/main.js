// AlertMap - Real-time auto-updating channels & state persistence
const CONFIG = {
    UPDATE_INTERVAL_MS: 5000, // Автоматичне оновлення кожні 5 секунд
    STORAGE_KEY: 'alertmap_selected_channels'
};

let selectedChannels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// 1. Завантаження збережених каналів з localStorage
function loadSavedChannels() {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (saved) {
        try {
            selectedChannels = JSON.parse(saved);
        } catch (e) {
            console.error('Помилка зчитання каналів з localStorage:', e);
        }
    }
}

// 2. Збереження стану каналів
function saveChannels(channels) {
    selectedChannels = channels;
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(channels));
}

// 3. Автоматичне фонове оновлення даних з сервера (без перезавантаження сторінки)
async function fetchLatestData() {
    try {
        const response = await fetch('/api/alerts-data');
        if (!response.ok) return;
        
        const data = await response.json();
        updateUI(data);
    } catch (error) {
        console.warn('Автоматичне оновлення очікує підключення:', error.message);
    }
}

// 4. Оновлення лічильників та кількості каналів на екрані
function updateUI(data) {
    const channelsElem = document.getElementById('channels-count');
    if (channelsElem) {
        const active = data.activeChannels ?? selectedChannels.length;
        const total = data.totalChannels ?? 10;
        channelsElem.textContent = `🟢 Канали ${active}/${total}`;
    }

    if (data.counts && data.counts.drones !== undefined) {
        const dronesElem = document.getElementById('drones-count');
        if (dronesElem) {
            dronesElem.textContent = data.counts.drones;
        }
    }
}

// 5. Ініціалізація та запуск таймера
document.addEventListener('DOMContentLoaded', () => {
    loadSavedChannels();
    fetchLatestData(); // Початковий запит

    // Запускаємо автоматичне оновлення у реальному часі
    setInterval(fetchLatestData, CONFIG.UPDATE_INTERVAL_MS);
});
