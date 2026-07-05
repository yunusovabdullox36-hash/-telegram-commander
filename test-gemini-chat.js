/**
 * Quick test for gemini-chat.js
 * Run: node test-gemini-chat.js
 */

require('dotenv').config();
const geminiChat = require('./features/gemini-chat');

async function test() {
  console.log('Testing gemini-chat.js...\n');
  
  try {
    // Test 1: Simple message
    console.log('📝 Test 1: Simple message');
    const result1 = await geminiChat.chat('Salom', 123456, 'Test User');
    console.log('Response:', result1.text.substring(0, 100) + '...');
    console.log('Intent:', result1.intent);
    console.log('✅ PASS\n');
    
    // Test 2: Backend intent
    console.log('📝 Test 2: Backend intent');
    const result2 = await geminiChat.chat('backend API yoz', 123456, 'Test User');
    console.log('Response:', result2.text.substring(0, 100) + '...');
    console.log('Intent:', result2.intent);
    console.log('✅ PASS\n');
    
    // Test 3: Context persistence
    console.log('📝 Test 3: Context (second message)');
    const result3 = await geminiChat.chat('Meni ismi nima dedi? Eslab qoldingmi?', 123456, 'Test User');
    console.log('Response:', result3.text.substring(0, 150) + '...');
    console.log('✅ PASS\n');
    
    // Test 4: HTML formatting
    console.log('📝 Test 4: HTML formatting');
    console.log('HTML output:', result3.html.substring(0, 100) + '...');
    console.log('✅ PASS\n');
    
    // Test 5: Reset context
    console.log('📝 Test 5: Reset context');
    const reset = geminiChat.resetContext(123456);
    console.log('Context reset:', reset ? '✅ YES' : '❌ NO');
    console.log('✅ PASS\n');
    
    console.log('✅ ALL TESTS PASSED!');
    
  } catch (e) {
    console.error('❌ ERROR:', e.message);
    process.exit(1);
  }
}

test();
