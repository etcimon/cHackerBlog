export default async function globalSetup() {
  console.log('='.repeat(80));
  console.log('Starting test suite...');
  console.log('='.repeat(80));
  
  // Log environment information for debugging
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? '***SET***' : 'NOT SET');
  console.log('CACHE_DRIVER:', process.env.CACHE_DRIVER || 'NOT SET');
  console.log('THEME:', process.env.THEME || 'NOT SET');
  console.log('='.repeat(80));
}
