module.exports = (sequelize, DataTypes) => {
	// Define model attributes to match existing DB column names and types exactly
	const User = sequelize.define('User', {
		Id: {
			type: DataTypes.INTEGER,
			primaryKey: true,
			field: 'Id',
			autoIncrement: true
		},
		AccessFailedCount: {
			type: DataTypes.INTEGER,
			allowNull: false,
			defaultValue: 0,
			field: 'AccessFailedCount'
		},
		Email: {
			type: DataTypes.TEXT,
			allowNull: false,
			unique: true,
			field: 'Email'
		},
		EmailConfirmado: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
			field: 'EmailConfirmado'
		},
		BloqueioAtivado: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: true,
			field: 'BloqueioAtivado'
		},
		FimBloqueio: {
			type: DataTypes.DATE,
			allowNull: true,
			field: 'FimBloqueio'
		},
		PremiumExpiresAt: {
			type: DataTypes.DATE,
			allowNull: true,
			field: 'PremiumExpiresAt'
		},
		PremiumExpiredAt: {
			type: DataTypes.DATE,
			allowNull: true,
			field: 'PremiumExpiredAt'
		},
		NomeUsuario: {
			type: DataTypes.TEXT,
			allowNull: true,
			field: 'NomeUsuario'
		},
		SenhaHash: {
			type: DataTypes.TEXT,
			allowNull: true,
			field: 'SenhaHash'
		},
		NumeroTelefone: {
			type: DataTypes.TEXT,
			allowNull: true,
			field: 'NumeroTelefone'
		},
		Nome: {
			type: DataTypes.TEXT,
			allowNull: true,
			field: 'Nome'
		},
		ForcarLogin: {
			type: DataTypes.BOOLEAN,
			allowNull: true,
			field: 'ForcarLogin'
		},
		DataCadastro: {
			type: DataTypes.DATE,
			allowNull: true,
			field: 'DataCadastro'
		},
		DataAlteracao: {
			type: DataTypes.DATE,
			allowNull: true,
			field: 'DataAlteracao'
		},
		DataExame: {
			type: DataTypes.TEXT,
			allowNull: true,
			field: 'data_exame'
		},
		Excluido: {
			type: DataTypes.BOOLEAN,
			allowNull: true,
			field: 'Excluido'
		}
	}, {
		tableName: 'Usuario',
		timestamps: false,
		// Don't pluralize table name
		freezeTableName: true
	});

	return User;
};
