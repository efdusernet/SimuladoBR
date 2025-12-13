module.exports = (sequelize, DataTypes) => {
  const OAuthAccount = sequelize.define('OAuthAccount', {
    Id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
    UserId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    Provider: { type: DataTypes.TEXT, allowNull: false, field: 'provider' },
    ProviderUserId: { type: DataTypes.TEXT, allowNull: false, field: 'provider_user_id' },
    Email: { type: DataTypes.TEXT, allowNull: true, field: 'email' },
    AccessTokenEnc: { type: DataTypes.TEXT, allowNull: true, field: 'access_token_enc' },
    RefreshTokenEnc: { type: DataTypes.TEXT, allowNull: true, field: 'refresh_token_enc' },
    CreatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'oauth_account',
    freezeTableName: true,
    timestamps: false,
  });
  return OAuthAccount;
};
