import type { ReactNode } from "react";
import {
  Alert,
  Card,
  Col,
  Collapse,
  Row,
  Space,
  Steps,
  Tag,
  Timeline,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  PayCircleOutlined,
  ShoppingOutlined,
  StopOutlined,
  TeamOutlined,
  TruckOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const { Paragraph, Text, Title } = Typography;

type ModuleCard = {
  title: string;
  desc: string;
  to: string;
  linkLabel: string;
  icon: ReactNode;
  tags?: string[];
  superAdminOnly?: boolean;
};

const MODULES: ModuleCard[] = [
  {
    title: "商品管理",
    desc: "创建与编辑商品、上传封面/详情图、配置套餐与广告追踪，控制上下架。",
    to: "/products",
    linkLabel: "进入商品列表",
    icon: <ShoppingOutlined />,
    tags: ["CRUD", "图片", "套餐"],
  },
  {
    title: "COD 待审核",
    desc: "核对收件信息；可批量通过、批量填备注，或批量转无效订单。",
    to: "/cod/pending_review",
    linkLabel: "进入待审核",
    icon: <DollarOutlined />,
    tags: ["批量通过", "批量备注", "转无效"],
  },
  {
    title: "COD 待确认",
    desc: "确认后进入待发货；支持批量确认、转无效，以及导出物流 Excel。",
    to: "/cod/awaiting_confirm",
    linkLabel: "进入待确认",
    icon: <CheckCircleOutlined />,
    tags: ["批量确认", "转无效", "物流导出"],
  },
  {
    title: "COD 待发货",
    desc: "选择寄件人、填写发货单号与归属成员；支持文本/Excel 批量发货或转无效。",
    to: "/cod/awaiting_shipment",
    linkLabel: "进入待发货",
    icon: <TruckOutlined />,
    tags: ["批量发货", "转无效"],
  },
  {
    title: "已发货 / 签收",
    desc: "跟踪在途订单，批量签收或拒绝签收；可导出物流与财务 Excel。",
    to: "/cod/shipped",
    linkLabel: "进入已发货",
    icon: <CheckCircleOutlined />,
    tags: ["签收", "拒收", "导出"],
  },
  {
    title: "无效订单",
    desc: "查看已作废订单；可批量恢复为作废前的状态（待审核 / 待确认 / 待发货）。",
    to: "/cod/invalid",
    linkLabel: "进入无效订单",
    icon: <StopOutlined />,
    tags: ["批量恢复"],
  },
  {
    title: "员工管理",
    desc: "创建员工账号、调整角色与启用状态，支持删除账号（仅超级管理员）。",
    to: "/employees",
    linkLabel: "进入员工管理",
    icon: <TeamOutlined />,
    tags: ["账号", "角色", "删除"],
    superAdminOnly: true,
  },
  {
    title: "寄件人管理",
    desc: "维护发货用的寄件人信息；发货时必须选择寄件人。",
    to: "/shippers",
    linkLabel: "进入寄件人",
    icon: <EnvironmentOutlined />,
    superAdminOnly: true,
  },
  {
    title: "地区管理",
    desc: "维护收件地区库，支持 Excel 导入，供商品与订单使用。",
    to: "/address-regions",
    linkLabel: "进入地区管理",
    icon: <GlobalOutlined />,
    superAdminOnly: true,
  },
  {
    title: "币种管理",
    desc: "维护商品可用币种与展示信息。",
    to: "/currencies",
    linkLabel: "进入币种管理",
    icon: <PayCircleOutlined />,
    superAdminOnly: true,
  },
];

export function DashboardPage() {
  const { isSuperAdmin, profile } = useAuth();
  const modules = MODULES.filter((m) => !m.superAdminOnly || isSuperAdmin);
  const displayName = profile?.display_name || profile?.email || "管理员";

  return (
    <div className="overview-page">
      <div className="page-header">
        <h1>概览</h1>
      </div>

      <div className="overview-hero">
        <div>
          <Title level={3} style={{ margin: "0 0 8px" }}>
            欢迎，{displayName}
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 12, maxWidth: 720 }}>
            ShopAD 是面向货到付款（COD）业务的商品与订单管理后台。主流程为：配置商品
            → 审核 → 确认 → 发货 → 签收/拒收。待审核至待发货阶段可转无效，无效订单可恢复原先状态；并支持物流与财务导出。
          </Paragraph>
          <Space wrap size={[8, 8]}>
            <Tag color="processing">仅处理 COD 订单</Tag>
            <Tag color={isSuperAdmin ? "gold" : "blue"}>
              {isSuperAdmin ? "超级管理员" : "员工"}
            </Tag>
            <Tag>Cloudflare + Supabase</Tag>
          </Space>
        </div>
      </div>

      <Title level={4} style={{ marginTop: 28, marginBottom: 12 }}>
        功能入口
      </Title>
      <Row gutter={[16, 16]}>
        {modules.map((m) => (
          <Col xs={24} sm={12} xl={8} key={m.to}>
            <Card className="overview-module-card" size="small">
              <Space align="start" size={12} style={{ width: "100%" }}>
                <span className="overview-module-icon">{m.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text strong style={{ fontSize: 15 }}>
                    {m.title}
                  </Text>
                  <Paragraph
                    type="secondary"
                    style={{ margin: "6px 0 10px", fontSize: 13 }}
                  >
                    {m.desc}
                  </Paragraph>
                  {m.tags?.length ? (
                    <Space wrap size={[4, 4]} style={{ marginBottom: 8 }}>
                      {m.tags.map((t) => (
                        <Tag key={t} style={{ margin: 0 }}>
                          {t}
                        </Tag>
                      ))}
                    </Space>
                  ) : null}
                  <div>
                    <Link to={m.to}>{m.linkLabel} →</Link>
                  </div>
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Title level={4} style={{ marginTop: 32, marginBottom: 12 }}>
        COD 订单流转
      </Title>
      <Card size="small" className="overview-flow-card">
        <Steps
          size="small"
          responsive
          items={[
            {
              title: "待审核",
              description: "核对信息 / 可转无效",
            },
            {
              title: "待确认",
              description: "确认后进入待发货",
            },
            {
              title: "待发货",
              description: "选寄件人并填运单",
            },
            {
              title: "已发货",
              description: "物流在途",
            },
            {
              title: "已签收 / 拒收",
              description: "终态结案",
            },
          ]}
        />
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          icon={<CloseCircleOutlined />}
          message="无效订单 vs 拒绝签收"
          description={
            <>
              「无效订单」仅用于待审核 / 待确认 / 待发货阶段作废，可在{" "}
              <Link to="/cod/invalid">无效订单</Link>{" "}
              批量恢复为作废前状态。
              「拒绝签收」仅在已发货后使用，二者不可互换。
            </>
          }
        />
      </Card>

      <Title level={4} style={{ marginTop: 32, marginBottom: 12 }}>
        操作教程
      </Title>
      <Collapse
        className="overview-guide"
        defaultActiveKey={["cod", "product"]}
        items={[
          {
            key: "cod",
            label: "COD 订单日常处理",
            children: (
              <Timeline
                items={[
                  {
                    children: (
                      <>
                        <Text strong>1. 审核</Text>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          打开{" "}
                          <Link to="/cod/pending_review">待审核</Link>
                          ，进入订单详情核对收件信息。可通过审核进入待确认；也可「批量通过」「批量填写备注」或「批量转无效订单」（需填写拒绝理由）。
                        </Paragraph>
                      </>
                    ),
                  },
                  {
                    children: (
                      <>
                        <Text strong>2. 确认</Text>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          在{" "}
                          <Link to="/cod/awaiting_confirm">待确认</Link>{" "}
                          核对后「批量确认」进入待发货；异常可「批量转无效」。同页可导出物流
                          Excel，便于发货准备。
                        </Paragraph>
                      </>
                    ),
                  },
                  {
                    children: (
                      <>
                        <Text strong>3. 发货</Text>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          在{" "}
                          <Link to="/cod/awaiting_shipment">待发货</Link>{" "}
                          或详情页选择寄件人，填写发货订单号与归属成员。也可「批量发货」：粘贴文本或上传
                          Excel（单次最多 200 笔）；仍可转无效。
                        </Paragraph>
                      </>
                    ),
                  },
                  {
                    children: (
                      <>
                        <Text strong>4. 签收结果</Text>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          在{" "}
                          <Link to="/cod/shipped">已发货</Link>{" "}
                          确认客户结果：批量签收进入「已签收」，或标记「拒绝签收」。同页可按时间范围导出物流/财务
                          Excel；「已签收」列表也可导出物流 Excel。
                        </Paragraph>
                      </>
                    ),
                  },
                  {
                    children: (
                      <>
                        <Text strong>5. 无效订单与恢复</Text>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          在{" "}
                          <Link to="/cod/invalid">无效订单</Link>{" "}
                          勾选后「批量恢复原先状态」：系统按审计日志还原作废前状态（待审核
                          / 待确认 / 待发货）；无记录时回退到待审核。详情页单笔操作同理。
                        </Paragraph>
                      </>
                    ),
                  },
                  {
                    children: (
                      <>
                        <Text strong>6. 批量查询</Text>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          任意 COD 列表可用「批量查询订单号」跨状态定位订单（换行、逗号或分号分隔均可）。
                        </Paragraph>
                      </>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: "product",
            label: "商品上架与配置",
            children: (
              <ol className="overview-ol">
                <li>
                  在 <Link to="/products">商品管理</Link>{" "}
                  点击「新建商品」，填写名称、价格、库存、币种与地区。
                </li>
                <li>
                  上传封面、图集与详情图；可配置套餐、SKU、外链后缀及广告像素（Facebook /
                  Google）。
                </li>
                <li>
                  保存后将状态设为「在售」对外展示；下架或删除请在列表中操作。编辑页可查看操作审计日志。
                </li>
              </ol>
            ),
          },
          {
            key: "export",
            label: "物流与财务导出",
            children: (
              <ol className="overview-ol">
                <li>
                  <Text strong>物流 Excel</Text>
                  ：在「待确认」「已发货」或「已签收」使用「导出物流 Excel」，对齐极兔模板；第
                  1 列为系统订单号，第 2 列为物流运单号。
                </li>
                <li>
                  <Text strong>财务 Excel</Text>
                  ：在「已发货」使用「导出财务 Excel」，按最近更新时间筛选，可按归属成员与商品过滤。
                </li>
                <li>若提示达到导出上限，请缩小时间范围或筛选条件后重试。</li>
              </ol>
            ),
          },
          ...(isSuperAdmin
            ? [
                {
                  key: "admin",
                  label: "超级管理员：基础数据与账号",
                  children: (
                    <ol className="overview-ol">
                      <li>
                        <Link to="/shippers">寄件人管理</Link>
                        ：发货前请至少添加一名寄件人，否则无法确认发货。
                      </li>
                      <li>
                        <Link to="/address-regions">地区管理</Link>
                        ：维护收件地区，支持 Excel 导入。
                      </li>
                      <li>
                        <Link to="/currencies">币种管理</Link>
                        ：配置商品可用币种。
                      </li>
                      <li>
                        <Link to="/employees">员工管理</Link>
                        ：创建员工账号、分配角色（超级管理员 /
                        员工）、启用/停用，或删除账号。
                      </li>
                    </ol>
                  ),
                },
              ]
            : []),
          {
            key: "roles",
            label: "角色与权限说明",
            children: (
              <ul className="overview-ul">
                <li>
                  <Text strong>员工</Text>
                  ：可管理商品与 COD
                  订单全流程（审核、确认、发货、签收、转无效/恢复、导出）。
                </li>
                <li>
                  <Text strong>超级管理员</Text>
                  ：在员工权限基础上，还可管理员工、寄件人、地区与币种。
                </li>
                <li>请使用管理员下发的邮箱密码登录；会话基于 Supabase Auth。</li>
              </ul>
            ),
          },
        ]}
      />
    </div>
  );
}
