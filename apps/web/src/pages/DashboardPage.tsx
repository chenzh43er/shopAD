import { Card, Col, Row, Statistic, Typography } from "antd";
import { Link } from "react-router-dom";

export function DashboardPage() {
  return (
    <div>
      <div className="page-header">
        <h1>概览</h1>
      </div>
      <Typography.Paragraph type="secondary">
        欢迎使用 ShopAD 管理后台。本系统仅处理货到付款（COD）订单。
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
            <Statistic title="COD订单" value="审核 / 发货 / 签收" />
            <Link to="/cod/pending_review">进入待审核 →</Link>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
