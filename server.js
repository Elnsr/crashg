const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// تقديم الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));

// توجيه الصفحات الرئيسية
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/prediction', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'prediction.html'));
});

// حالة اللعبة العامة
const gameState = {
  status: 'waiting', // waiting, active, crashed
  multiplier: 1.0,
  countdown: 7,
  crashPoint: 0,
  lastCrashPoint: 0,
  roundStartTime: 0,
  nextCrashPoint: 0
};

// وظيفة توليد نقطة انفجار تكون بين 1 و 10
function generateCrashPoint() {
  const rand = Math.random();
  
  if (rand < 0.6) { // 60% فرصة للحصول على قيمة بين 1.00-2.00
    return parseFloat((1 + Math.random()).toFixed(2));
  } else if (rand < 0.85) { // 25% فرصة للحصول على قيمة بين 2.00-4.00
    return parseFloat((2 + Math.random() * 2).toFixed(2));
  } else if (rand < 0.95) { // 10% فرصة للحصول على قيمة بين 4.00-7.00
    return parseFloat((4 + Math.random() * 3).toFixed(2));
  } else { // 5% فرصة للحصول على قيمة بين 7.00-10.00
    return parseFloat((7 + Math.random() * 3).toFixed(2));
  }
}

// توليد نقطة انفجار للجولة الأولى
gameState.nextCrashPoint = generateCrashPoint();

// وظيفة إرسال تحديثات حالة اللعبة لجميع العملاء
function broadcastGameState() {
  const stateToSend = { ...gameState };
  
  // تعديل البيانات التي يتم إرسالها بناءً على حالة اللعبة
  if (gameState.status === 'waiting') {
    stateToSend.countdown = Math.max(0, 7 - Math.floor((Date.now() - gameState.roundStartTime) / 1000));
  } else if (gameState.status === 'active') {
    const elapsedSeconds = (Date.now() - gameState.roundStartTime) / 1000;
    const growthFactor = 0.05; // معامل النمو (يمكن تعديله)
    stateToSend.multiplier = parseFloat((1 + elapsedSeconds * growthFactor).toFixed(2));
  }
  
  // إرسال حالة اللعبة لجميع العملاء المتصلين
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(stateToSend));
    }
  });
}

// وظيفة بدء جولة جديدة
function startNewRound() {
  // تعيين حالة اللعبة إلى "انتظار"
  gameState.status = 'waiting';
  gameState.multiplier = 1.0;
  gameState.countdown = 7;
  gameState.roundStartTime = Date.now();
  gameState.crashPoint = gameState.nextCrashPoint;
  
  // توليد نقطة انفجار للجولة القادمة
  gameState.nextCrashPoint = generateCrashPoint();
  
  console.log(`بدء جولة جديدة. نقطة الانفجار: ${gameState.crashPoint}x، التوقع القادم: ${gameState.nextCrashPoint}x`);
  
  // بدء العد التنازلي
  broadcastGameState();
  
  // تعيين موقت للانتقال إلى حالة "نشط" بعد انتهاء العد التنازلي
  setTimeout(() => {
    gameState.status = 'active';
    gameState.roundStartTime = Date.now();
    console.log('بدأت الجولة!');
    broadcastGameState();
    
    // بدء فحص الانفجار
    checkForCrash();
  }, 7000);
}

// وظيفة التحقق من الانفجار
function checkForCrash() {
  // حساب المضاعف الحالي
  const elapsedSeconds = (Date.now() - gameState.roundStartTime) / 1000;
  const growthFactor = 0.05; // معامل النمو (يجب أن يكون متطابقًا مع القيمة في broadcastGameState)
  const currentMultiplier = 1 + elapsedSeconds * growthFactor;
  
  // التحقق مما إذا كان المضاعف قد وصل إلى نقطة الانفجار
  if (currentMultiplier >= gameState.crashPoint) {
    // انفجار!
    gameState.status = 'crashed';
    gameState.multiplier = gameState.crashPoint;
    gameState.lastCrashPoint = gameState.crashPoint;
    
    console.log(`انفجار عند ${gameState.crashPoint}x!`);
    
    // إرسال حالة الانفجار لجميع العملاء
    broadcastGameState();
    
    // انتظر ثانيتين قبل بدء جولة جديدة
    setTimeout(startNewRound, 2000);
  } else {
    // لم ينفجر بعد، استمر في الفحص
    setTimeout(checkForCrash, 100);
  }
}

// تعامل مع اتصالات الويب سوكيت
wss.on('connection', (ws) => {
  console.log('عميل جديد متصل');
  
  // إرسال حالة اللعبة الحالية للعميل الجديد
  ws.send(JSON.stringify(gameState));
  
  // استقبال الرسائل من العميل
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('رسالة مستلمة:', data);
      
      // يمكن إضافة معالجة رسائل إضافية هنا إذا لزم الأمر
    } catch (error) {
      console.error('خطأ في تحليل الرسالة:', error);
    }
  });
});

// إرسال تحديثات منتظمة لحالة اللعبة (كل 1 ثانية)
setInterval(broadcastGameState, 1000);

// بدء الجولة الأولى
startNewRound();

// بدء الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});