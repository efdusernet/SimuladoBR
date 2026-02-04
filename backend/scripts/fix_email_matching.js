/**
 * Script to diagnose and fix email matching issue
 * 
 * Problem: User login with "eliel.deuclides@gmail.com" is matching "eliel.deuclides1@gmail.com"
 * This is a CRITICAL security vulnerability allowing unauthorized access
 */

const db = require('../models');
const { User } = db;
const { sequelize } = db;

async function diagnoseEmailMatching() {
    console.log('=== Email Matching Diagnosis ===\n');

    try {
        // Test 1: Check collation of Email column
        console.log('1. Checking Email column collation...');
        const [collationResult] = await sequelize.query(`
            SELECT 
                table_name, 
                column_name, 
                data_type, 
                collation_name,
                is_nullable,
                column_default
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'usuario' 
            AND column_name = 'Email';
        `);
        console.log('Email column info:', JSON.stringify(collationResult, null, 2));

        // Test 2: Check indexes on Email column
        console.log('\n2. Checking indexes on Email column...');
        const [indexResult] = await sequelize.query(`
            SELECT 
                indexname, 
                indexdef
            FROM pg_indexes 
            WHERE schemaname = 'public' 
            AND tablename = 'usuario' 
            AND indexdef ILIKE '%Email%';
        `);
        console.log('Email indexes:', JSON.stringify(indexResult, null, 2));

        // Test 3: Test actual query behavior
        console.log('\n3. Testing actual query behavior...');
        
        const testEmail = 'eliel.deuclides@gmail.com';
        console.log(`\nQuerying with email: "${testEmail}"`);
        
        // Using Sequelize
        const userSequelize = await User.findOne({ 
            where: { Email: testEmail },
            attributes: ['Id', 'Email', 'NomeUsuario']
        });
        console.log('Sequelize result:', userSequelize ? userSequelize.toJSON() : null);

        // Using raw SQL with exact match
        const [rawExact] = await sequelize.query(`
            SELECT "Id", "Email", "NomeUsuario" 
            FROM public.usuario 
            WHERE "Email" = :email
            LIMIT 1;
        `, { 
            replacements: { email: testEmail },
            type: sequelize.QueryTypes.SELECT 
        });
        console.log('Raw SQL (exact =):', rawExact);

        // Using raw SQL with LIKE
        const [rawLike] = await sequelize.query(`
            SELECT "Id", "Email", "NomeUsuario" 
            FROM public.usuario 
            WHERE "Email" LIKE :pattern
            LIMIT 1;
        `, { 
            replacements: { pattern: testEmail + '%' },
            type: sequelize.QueryTypes.SELECT 
        });
        console.log('Raw SQL (LIKE):', rawLike);

        // Test 4: Check all emails starting with "eliel.deuclides"
        console.log('\n4. Checking all similar emails...');
        const [similarEmails] = await sequelize.query(`
            SELECT "Id", "Email", "NomeUsuario" 
            FROM public.usuario 
            WHERE "Email" LIKE 'eliel.deuclides%'
            ORDER BY "Email";
        `);
        console.log('Similar emails:', JSON.stringify(similarEmails, null, 2));

        // Test 5: Check Sequelize where clause generation
        console.log('\n5. Checking Sequelize where clause...');
        const sqlGenerated = User.findOne({ 
            where: { Email: testEmail },
            logging: console.log
        });

    } catch (error) {
        console.error('Error during diagnosis:', error);
    }
}

async function fixEmailMatching() {
    console.log('\n=== Applying Fix ===\n');

    try {
        // Fix: Ensure Email column uses proper collation
        console.log('Attempting to set proper collation on Email column...');
        
        // This will set the collation to "C" which is binary and case-sensitive
        await sequelize.query(`
            ALTER TABLE public.usuario 
            ALTER COLUMN "Email" 
            TYPE TEXT COLLATE "C";
        `);
        
        console.log('✓ Email column collation updated to "C" (case-sensitive, binary)');
        
        // Verify the change
        const [verification] = await sequelize.query(`
            SELECT collation_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'usuario' 
            AND column_name = 'Email';
        `);
        console.log('New collation:', verification);

    } catch (error) {
        console.error('Error applying fix:', error);
        console.log('\nIf the error is about existing data or indexes, you may need to:');
        console.log('1. Drop the unique index on Email');
        console.log('2. Change the column collation');
        console.log('3. Recreate the unique index');
    }
}

async function main() {
    try {
        await diagnoseEmailMatching();
        
        console.log('\n\n' + '='.repeat(60));
        console.log('Do you want to apply the fix? (requires manual confirmation)');
        console.log('Uncomment the line below and run again:');
        console.log('='.repeat(60));
        
        // await fixEmailMatching();

    } catch (error) {
        console.error('Fatal error:', error);
    } finally {
        await sequelize.close();
    }
}

main();
