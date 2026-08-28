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
  AppstoreOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  LinkOutlined,
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
    desc: "创建与编辑商品，配置域名、链接后缀、套餐与广告像素（Facebook / Google），上传封面与详情图，控制上下架；已删除商品可恢复。",
    to: "/products",
    linkLabel: "进入商品列表",
    icon: <ShoppingOutlined />,
    tags: ["域名", "套餐", "像素"],
  },
  {
    title: "全部订单",
    desc: "浏览全部 COD 订单，按日期、订单号、手机号筛选；支持批量粘贴查询，并可自定义列导出 Excel。",
    to: "/cod/all",
    linkLabel: "进入全部订单",
    icon: <AppstoreOutlined />,
    tags: ["筛选", "批量查询", "导出"],
  },
  {
    title: "COD 待审核",
    desc: "核对收件信息；可批量通过、批量填写备注，或批量转无效订单（需填写理由）。",
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
    desc: "选择寄件人、填写运单号与归属成员；支持文本或 Excel 批量发货，亦可转无效。",
    to: "/cod/awaiting_shipment",
    linkLabel: "进入待发货",
    icon: <TruckOutlined />,
    tags: ["批量发货", "转无效"],
  },
  {
    title: "已发货",
    desc: "跟踪在途订单，批量签收或拒绝签收；可导出物流与财务 Excel，并支持批量查询运单号。",
    to: "/cod/shipped",
    linkLabel: "进入已发货",
    icon: <TruckOutlined />,
    tags: ["签收", "拒收", "导出"],
  },
  {
    title: "已签收",
    desc: "查看已完成签收的 COD 订单，支持导出物流 Excel 与恢复上一步。",
    to: "/cod/completed",
    linkLabel: "进入已签收",
    icon: <CheckCircleOutlined />,
    tags: ["物流导出", "恢复上一步"],
  },
  {
    title: "拒绝签收",
    desc: "查看客户拒收订单；可恢复上一步后重新处理，与「无效订单」用途不同。",
    to: "/cod/refused",
    linkLabel: "进入拒绝签收",
    icon: <CloseCircleOutlined />,
    tags: ["恢复上一步"],
  },
  {
    title: "无效订单",
    desc: "查看待审核 / 待确认 / 待发货阶段作废的订单；除「待审核」外各 Tab 均可用「恢复上一步」回退。超级管理员可永久删除。",
    to: "/cod/invalid",
    linkLabel: "进入无效订单",
    icon: <StopOutlined />,
    tags: ["恢复上一步", "批量删除"],
    superAdminOnly: false,
  },
  {
    title: "员工管理",
    desc: "创建员工账号、分配地区与角色、启用/停用；超级管理员可删除账号。",
    to: "/employees",
    linkLabel: "进入员工管理",
    icon: <TeamOutlined />,
    tags: ["账号", "角色", "地区"],
    superAdminOnly: true,
  },
  {
    title: "寄件人管理",
    desc: "维护发货用的寄件人信息；确认发货时必须选择寄件人。",
    to: "/shippers",
    linkLabel: "进入寄件人",
    icon: <EnvironmentOutlined />,
    tags: ["发货必填"],
    superAdminOnly: true,
  },
  {
    title: "地区管理",
    desc: "维护收件地区库（含区号），支持 Excel 导入；商品与员工账号均须关联地区。",
    to: "/address-regions",
    linkLabel: "进入地区管理",
    icon: <GlobalOutlined />,
    tags: ["Excel 导入"],
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
  {
    title: "域名管理",
    desc: "维护商品落地页域名；商品上架前须选择已启用的域名，配合链接后缀生成访问地址。",
    to: "/domains",
    linkLabel: "进入域名管理",
    icon: <LinkOutlined />,
    tags: ["落地页"],
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
            ShopAD 是面向货到付款（COD）业务的商品与订单管理后台。主流程为：配置商品与落地页
            → 审核 → 确认 → 发货 → 签收或拒收。待审核至待发货阶段可转无效；除待审核外，各状态均支持「恢复上一步」。另提供物流/财务导出、自定义列订单导出及批量查询（订单号、手机号、运单号）。
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
              description: "两种终态结案",
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
              「无效订单」用于待审核 / 待确认 / 待发货阶段作废，可在{" "}
              <Link to="/cod/invalid">无效订单</Link>{" "}
              通过「恢复上一步」回退。
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
                          Excel；仍可转无效。
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
                          确认客户结果：批量签收进入{" "}
                          <Link to="/cod/completed">已签收</Link>，或标记{" "}
                          <Link to="/cod/refused">拒绝签收</Link>。同页可按时间范围导出物流/财务
                          Excel；「已签收」列表也可导出物流 Excel。
                        </Paragraph>
                      </>
                    ),
                  },
                  {
                    children: (
                      <>
                        <Text strong>5. 恢复上一步</Text>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          除「待审核」外，各 COD 列表页均提供「恢复上一步」：系统按审计日志回退至上一状态（如已签收
                          → 已发货，无效订单 → 作废前状态）；详情页亦支持单笔操作。
                        </Paragraph>
                      </>
                    ),
                  },
                  {
                    children: (
                      <>
                        <Text strong>6. 批量查询</Text>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          任意 COD 列表可用「批量查询订单号 / 手机号 / 运单号」定位订单（换行、逗号或分号分隔均可）。
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
                  超级管理员先在 <Link to="/domains">域名管理</Link>{" "}
                  添加落地页域名，并在 <Link to="/address-regions">地区管理</Link>、{" "}
                  <Link to="/currencies">币种管理</Link> 完成基础配置。
                </li>
                <li>
                  在 <Link to="/products">商品管理</Link>{" "}
                  点击「新建商品」，填写名称、价格、地区与币种，并选择域名与链接后缀。
                </li>
                <li>
                  上传封面、图集与详情图；可配置套餐、SKU 及广告像素（Facebook /
                  Google）。
                </li>
                <li>
                  保存后将状态设为「在售」对外展示；下架或删除请在列表中操作，「已删除」Tab
                  可恢复并重新上架。编辑页可查看操作审计日志。
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
                  <Text strong>自定义列导出</Text>
                  ：在 <Link to="/cod/all">全部订单</Link>{" "}
                  使用「导出订单」，按当前筛选条件勾选需要的数据列导出 Excel。
                </li>
                <li>
                  <Text strong>物流 Excel</Text>
                  ：在「待确认」「已发货」或「已签收」使用「导出物流 Excel」，对齐极兔模板；第
                  1 列为系统订单号，第 2 列为物流运单号。
                </li>
                <li>
                  <Text strong>财务 Excel</Text>
                  ：在「已发货」使用「导出财务 Excel」，按订单创建日期筛选，可按归属成员与商品过滤。
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
                        <Link to="/domains">域名管理</Link>
                        ：商品上架前须配置至少一个已启用域名。
                      </li>
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
                        ：创建员工账号、分配地区与角色（超级管理员 /
                        员工）、启用/停用，或删除账号。
                      </li>
                      <li>
                        在 COD 列表勾选订单后可「强制流转状态」；在{" "}
                        <Link to="/cod/invalid">无效订单</Link>{" "}
                        可「批量删除订单」（永久删除，不可恢复）。
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
                  订单全流程（审核、确认、发货、签收、转无效/恢复上一步、导出）。
                </li>
                <li>
                  <Text strong>超级管理员</Text>
                  ：在员工权限基础上，还可管理员工、寄件人、地区、币种与域名；可强制流转订单状态、永久删除无效订单。
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
