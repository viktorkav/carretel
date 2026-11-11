import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';

function bancoEmMemoria() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './drizzle' });
	return db;
}

describe('schema', () => {
	it('grava e lê um rolo com a ficha do filamento dentro dele', () => {
		const db = bancoEmMemoria();
		const [r] = db
			.insert(schema.rolo)
			.values({
				codigo: 'PLA-PRETO-01',
				marca: 'Bambu',
				material: 'PLA',
				cor: 'Preto',
				precoPagoCents: 12900
			})
			.returning()
			.all();

		expect(r.marca).toBe('Bambu');
		expect(r.densidade).toBeCloseTo(1.24);
		expect(r.fonteCatalogo).toBe('manual');
		expect(r.pesoLiquidoInicialG).toBe(1000);
		expect(r.status).toBe('fechado');
	});

	/**
	 * Antes da fusão o teste daqui era o oposto: recusar rolo apontando para
	 * filamento inexistente. Não há mais para onde apontar — o que o banco
	 * precisa garantir agora é que dois carretéis na prateleira não recebam o
	 * mesmo nome escrito na caneta.
	 */
	it('recusa dois rolos com o mesmo código', () => {
		const db = bancoEmMemoria();
		const rolo = { codigo: 'PLA-PRETO-01', marca: 'Bambu', material: 'PLA', cor: 'Preto' };
		db.insert(schema.rolo).values(rolo).run();
		expect(() => db.insert(schema.rolo).values({ ...rolo, precoPagoCents: 9900 }).run()).toThrow();
	});

	it('aceita dois rolos idênticos com códigos diferentes — é o ponto da fusão', () => {
		const db = bancoEmMemoria();
		const ficha = { marca: 'Bambu', material: 'PLA', cor: 'Preto' };
		db.insert(schema.rolo).values({ ...ficha, codigo: 'PLA-PRETO-01', precoPagoCents: 12000 }).run();
		db.insert(schema.rolo).values({ ...ficha, codigo: 'PLA-PRETO-02', precoPagoCents: 13500 }).run();

		const rolos = db.select().from(schema.rolo).all();
		expect(rolos).toHaveLength(2);
		expect(rolos.map((r) => r.precoPagoCents)).toEqual([12000, 13500]);
	});
});
