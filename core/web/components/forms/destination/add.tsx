import { useState, useEffect } from "react";
import { useApi } from "../../../hooks/useApi";
import { Row, Col, Form, Button, Card } from "react-bootstrap";
import AppIcon from "../../appIcon";
import Link from "next/link";
import Router from "next/router";

export default function ({ apiVersion, errorHandler, successHandler }) {
  const { execApi } = useApi(errorHandler);
  const [connectionApps, setConnectionApps] = useState([]);
  const [destination, setDestination] = useState({
    appGuid: "",
    type: "",
  });

  useEffect(() => {
    loadApps();
  }, []);

  async function loadApps() {
    const connectionsResponse = await execApi(
      "get",
      `/api/${apiVersion}/destinations/connectionApps`
    );
    if (connectionsResponse?.connectionApps) {
      setConnectionApps(connectionsResponse.connectionApps);
    }
  }

  const onSubmit = async (event) => {
    event.preventDefault();
    const response = await execApi(
      "post",
      `/api/${apiVersion}/destination`,
      destination
    );
    if (response?.destination) {
      successHandler.set({ message: "Destination Created" });
      Router.push(`/destination/${response.destination.guid}?tab=edit`);
    }
  };

  const update = async (event) => {
    const _destination = Object.assign({}, destination);
    _destination[event.target.id] = event.target.value;
    setDestination(_destination);
  };

  if (connectionApps.length === 0) {
    return (
      <p>
        Please create an{" "}
        <Link href="/apps">
          <a>App</a>
        </Link>{" "}
        first.
      </p>
    );
  }

  return (
    <>
      <h2>Choose App and Connection</h2>

      <Form id="form" onSubmit={onSubmit}>
        <Form.Group controlId="type">
          <Form.Control
            hidden={true}
            type="text"
            disabled
            value={destination.type}
          />
        </Form.Group>

        <Form.Group controlId="appGuid">
          <Form.Control
            hidden={true}
            type="text"
            disabled
            value={destination.appGuid}
          />
        </Form.Group>

        <Row>
          {connectionApps.map((pair) => {
            const { connection: _connection, app: _app } = pair;
            return (
              <Col key={`connection-${_app.name}-${_connection.name}`} md={3}>
                <Card
                  style={{ marginBottom: 20 }}
                  bg={
                    destination.appGuid === _app.guid &&
                    destination.type === _connection.name
                      ? "success"
                      : "secondary"
                  }
                  onClick={() => {
                    const _destination = Object.assign({}, destination);
                    _destination.type = _connection.name;
                    _destination.appGuid = _app.guid;
                    setDestination(_destination);
                  }}
                >
                  <Card.Body>
                    <AppIcon className="card-img" src={_app.icon} fluid />
                    <br />
                    <br />
                    <div style={{ textAlign: "center" }}>
                      <h4>{_connection.name}</h4>
                      <strong>{_app.name}</strong>
                    </div>
                    <br />
                    {_connection.description}
                  </Card.Body>
                </Card>
              </Col>
            );
          })}

          <Col md={3}>
            <Card onClick={() => Router.push("/app/new")}>
              <Card.Body style={{ textAlign: "center" }}>
                <p>Don’t see what you’re looking for?</p>
                <p>Connect a new App</p>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <br />
        <Button type="submit">Create Destination</Button>
      </Form>
    </>
  );
}
