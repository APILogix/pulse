import net from 'net';

const start = Date.now();
console.log('Connecting to db.dznzazqefvakycgkwivn.supabase.co:5432...');

const socket = net.connect(5432, 'db.dznzazqefvakycgkwivn.supabase.co', () => {
  const elapsed = Date.now() - start;
  console.log(`TCP Connected in ${elapsed}ms! Remote IP:`, socket.remoteAddress);
  socket.end();
});

socket.on('error', (err) => {
  const elapsed = Date.now() - start;
  console.error(`Socket error after ${elapsed}ms:`, err);
});
