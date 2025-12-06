module.exports = (sequelize, DataTypes) => {
  const EmailVerification = sequelize.define('EmailVerification', {
    Id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      field: 'Id'
    },
    UserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'UserId'
    },
    Token: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: 'Token'
    },
    ExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'ExpiresAt'
    },
    Used: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'Used'
    },
    CreatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'CreatedAt'
    },
    Meta: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'Meta'
    }
  }, {
    tableName: 'EmailVerification',
    timestamps: false,
    freezeTableName: true
  });

  return EmailVerification;
};
