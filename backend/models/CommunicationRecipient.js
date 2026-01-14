module.exports = (sequelize, DataTypes) => {
  const CommunicationRecipient = sequelize.define('CommunicationRecipient', {
    Id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'id' },
    UserId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    Ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active' },
    CreatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    UpdatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  }, {
    tableName: 'communication_recipient',
    freezeTableName: true,
    timestamps: false,
  });

  return CommunicationRecipient;
};
