// 1. Supabase Connection Settings
const SUPABASE_URL = "https://ttrxmfpgiyynuyxmzpab.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_9Jgu6VPfEM2xZgUBLqHNXg_A8rWHlRO";

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 2. DOM Elements
const authContainer = document.getElementById("auth-container");
const chatContainer = document.getElementById("chat-container");
const authForm = document.getElementById("auth-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const displayNameInput = document.getElementById("display-name");
const displayNameGroup = document.getElementById("display-name-group");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authToggleText = document.getElementById("auth-toggle-text");
const authError = document.getElementById("auth-error");

const currentUserNameSpan = document.getElementById("current-user-name");
const logoutBtn = document.getElementById("logout-btn");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageList = document.getElementById("message-list");

// State
let isSignUpMode = true;
let currentUser = null;
let currentProfile = null;
let messages = [];
let profilesMap = {};

// 3. Auth UI Toggle (Sign Up vs Log In)
function setupToggleListener() {
    const toggleModeLink = document.getElementById("toggle-mode");
    if (toggleModeLink) {
        toggleModeLink.addEventListener("click", (e) => {
            e.preventDefault();
            isSignUpMode = !isSignUpMode;
            updateAuthFormUI();
        });
    }
}

function updateAuthFormUI() {
    if (isSignUpMode) {
        displayNameGroup.style.display = "block";
        displayNameInput.required = true;
        authSubmitBtn.textContent = "Sign Up";
        authToggleText.innerHTML = 'Already have an account? <a href="#" id="toggle-mode">Log in</a>';
    } else {
        displayNameGroup.style.display = "none";
        displayNameInput.required = false;
        authSubmitBtn.textContent = "Log In";
        authToggleText.innerHTML = 'Need an account? <a href="#" id="toggle-mode">Sign up</a>';
    }
    authError.textContent = "";
    setupToggleListener(); // Re-bind listener to the newly created link
}

// Initial binding
setupToggleListener();

// 4. Authentication Handler (Sign Up / Log In)
authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.textContent = "";
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    try {
        if (isSignUpMode) {
            const displayName = displayNameInput.value.trim();
            if (displayName.length < 2 || displayName.length > 24) {
                throw new Error("Display name must be between 2 and 24 characters.");
            }

            const { data, error } = await client.auth.signUp({
                email,
                password,
                options: {
                    data: { display_name: displayName }
                }
            });
            if (error) throw error;
            alert("Account created successfully!");
        } else {
            const { data, error } = await client.auth.signInWithPassword({
                email,
                password
            });
            if (error) throw error;
        }
    } catch (err) {
        authError.textContent = err.message;
    }
});

// 5. Logout Handler
logoutBtn.addEventListener("click", async () => {
    await client.auth.signOut();
});

// 6. Auth State Listener & Session Check
client.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
        authContainer.classList.add("hidden");
        chatContainer.classList.remove("hidden");
        await fetchProfile();
        await loadInitialData();
        setupRealtimeSubscription();
    } else {
        authContainer.classList.remove("hidden");
        chatContainer.classList.add("hidden");
        messages = [];
        messageList.innerHTML = "";
    }
});

async function fetchProfile() {
    const { data, error } = await client
        .from("profiles")
        .select("display_name")
        .eq("id", currentUser.id)
        .single();
    
    if (data) {
        currentProfile = data;
        currentUserNameSpan.textContent = data.display_name;
    }
}

async function loadNames(userIds) {
    const missingIds = userIds.filter(id => !profilesMap[id]);
    if (missingIds.length === 0) return;

    const { data, error } = await client
        .from("profiles")
        .select("id, display_name")
        .in("id", missingIds);

    if (data) {
        data.forEach(p => {
            profilesMap[p.id] = p.display_name;
        });
    }
}

// 7. Load Message History
async function loadInitialData() {
    const { data, error } = await client
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(50);

    if (error) {
        console.error("Error loading messages:", error);
        return;
    }

    messages = data || [];
    const userIds = [...new Set(messages.map(m => m.user_id))];
    await loadNames(userIds);
    renderMessages();
}

// 8. Render Messages to DOM
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMessages() {
    messageList.innerHTML = "";

    if (messages.length === 0) {
        const emptyState = document.createElement("div");
        emptyState.textContent = "No messages yet";
        emptyState.style.textAlign = "center";
        emptyState.style.color = "var(--text-muted)";
        emptyState.style.marginTop = "2rem";
        messageList.appendChild(emptyState);
        return;
    }

    messages.forEach((msg) => {
        const item = document.createElement("div");
        const isMine = msg.user_id === currentUser?.id;
        item.className = "message " + (isMine ? "mine" : "other");

        const author = document.createElement("span");
        author.className = "author";
        author.textContent = profilesMap[msg.user_id] || "Unknown";

        const text = document.createElement("span");
        text.className = "text";
        text.textContent = msg.text;

        const time = document.createElement("time");
        time.textContent = formatTime(msg.created_at);

        item.append(author, text, time);
        messageList.appendChild(item);
    });

    messageList.scrollTop = messageList.scrollHeight;
}

// 9. Send Message Form Handler
messageForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (text === "") return;

    // Check for bot command first
    if (text.toLowerCase().startsWith("/weather")) {
        messageInput.value = "";
        await handleCommand(text);
        return;
    }

    const { error } = await client
        .from("messages")
        .insert([{ text: text }]);

    if (error) {
        alert("Failed to send: " + error.message);
        console.error(error);
    } else {
        messageInput.value = "";
    }
    messageInput.focus();
});

// 10. Realtime Subscription (WebSockets)
function setupRealtimeSubscription() {
    client
        .channel("public:messages")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            async (payload) => {
                const newMsg = payload.new;
                if (!messages.some(m => m.id === newMsg.id)) {
                    await loadNames([newMsg.user_id]);
                    messages.push(newMsg);
                    renderMessages();
                }
            }
        )
        .on(
            "postgres_changes",
            { event: "DELETE", schema: "public", table: "messages" },
            (payload) => {
                messages = messages.filter(m => m.id !== payload.old.id);
                renderMessages();
            }
        )
        .subscribe();
}

// 11. Weather Bot (Open-Meteo API integration)
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

function describeWeather(code) {
    if (code == 0) return "clear sky";
    if (code <= 3) return "partly cloudy";
    if (code <= 48) return "foggy";
    if (code <= 57) return "drizzle";
    if (code <= 67) return "rain";
    if (code <= 77) return "snow";
    if (code <= 82) return "rain showers";
    if (code <= 86) return "snow showers";
    return "thunderstorm";
}

async function getWeather(city) {
    const geoUrl = GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1";
    const geoResponse = await fetch(geoUrl);
    if (!geoResponse.ok) throw new Error("Geocoding failed");
    const geoData = await geoResponse.json();

    if (!geoData.results) {
        return "Sorry, I could not find a city named " + city + ".";
    }
    const place = geoData.results[0];

    const weatherUrl =
        WEATHER_URL +
        "?latitude=" + place.latitude +
        "&longitude=" + place.longitude +
        "&current=temperature_2m,weather_code,wind_speed_10m";

    const weatherResponse = await fetch(weatherUrl);
    if (!weatherResponse.ok) throw new Error("Weather failed");
    const weatherData = await weatherResponse.json();
    const now = weatherData.current;

    return (
        place.name + ", " + place.country + ": " +
        now.temperature_2m + " degrees C, " +
        describeWeather(now.weather_code) + ", wind " +
        now.wind_speed_10m + " km/h"
    );
}

async function handleCommand(text) {
    const words = text.split(" ");
    const city = words.slice(1).join(" ").trim();
    let reply;

    if (city === "") {
        reply = "Try it like this: /weather Manila";
    } else {
        try {
            reply = await getWeather(city);
        } catch (error) {
            console.error(error);
            reply = "Sorry, the weather service is not answering right now.";
        }
    }

    // Append local bot response only for the current user
    messages.push({
        id: "bot-" + Date.now(),
        user_id: "weather-bot",
        text: "WeatherBot: " + reply,
        created_at: new Date().toISOString()
    });
    
    // Inject temporary name for bot
    profilesMap["weather-bot"] = "WeatherBot";
    renderMessages();
}