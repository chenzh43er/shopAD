import { Card, Col, Row, Statistic, Typography } from "antd";
import { Link } from "react-router-dom";

export function DashboardPage() {
  return (
    <div>
      <div className="page-header">
        <h1>概览</h1>
      </div>
      <Typography.Paragraph type="secondary">
        欢迎使用 ShopAD 管理后台。请从侧栏进入商品或订单管理。
      </Typography.Paragraph>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card>
            <Statistic title="商品管理" value="CRUD / 上下架 / 图片" />
            <Link to="/products">进入商品列表 →</Link>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card>
            <Statistic title="订单管理" value="列表 / 状态流转" />
            <Link to="/orders">进入订单列表 →</Link>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
