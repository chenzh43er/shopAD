import { useState } from "react";
import { Alert, Button, Form, Input, message } from "antd";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

interface LoginForm {
  email: string;
  password: string;
}

export function LoginPage() {
  const { session, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? "/";

  if (!loading && session) {
    return <Navigate to={from} replace />;
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-brand">ShopAD</h1>
        <p className="login-sub">商品与订单管理后台</p>
        {error ? (
          <Alert
            type="error"
            message={error}
            showIcon
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form<LoginForm>
          layout="vertical"
          requiredMark={false}
          onFinish={async (values) => {
            setSubmitting(true);
            setError(null);
            try {
              await signIn(values.email.trim(), values.password);
              message.success("登录成功");
              navigate(from, { replace: true });
            } catch (e) {
              setError(e instanceof Error ? e.message : "登录失败");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item
            label="邮箱"
            name="email"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "邮箱格式不正确" },
            ]}
          >
            <Input size="large" placeholder="admin@example.com" autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password
              size="large"
              placeholder="密码"
              autoComplete="current-password"
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            block
            loading={submitting}
          >
            登录
          </Button>
        </Form>
      </div>
    </div>
  );
}
