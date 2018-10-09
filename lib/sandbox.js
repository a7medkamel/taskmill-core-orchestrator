"use strict";

var Promise         = require('bluebird')
  , _               = require('lodash')
  , config          = require('config')
  , ms              = require('ms')
  , Dockerode       = require('dockerode')
  , make_sdk        = require('taskmill-core-make-sdk')
  ;

// '/var/run/docker.sock'
// /* Pattern */ 'http://unix:SOCKET:PATH'
// /* Example */ request.get('http://unix:/absolute/path/to/unix.socket:/request/path')

const hostname    = config.get('orchestrator.swarm.hostname')
    , protocol    = config.get('orchestrator.swarm.protocol')
    , port        = config.get('orchestrator.swarm.port')
    , cert        = config.get('orchestrator.swarm.cert')
    , key         = config.get('orchestrator.swarm.key')
    , passphrase  = config.get('orchestrator.swarm.passphrase')
    , ca          = config.get('orchestrator.swarm.ca')
    ;

var dockerode = new Dockerode({ Promise, protocol, host : hostname, port, ca, cert, key, passphrase });

// todo [akamel] if service fails to boot, detect wait-on timeout and del redis entry (let it get deleted)
class Sandbox {
  static sweep() {
    return Sandbox
            .list()
            .then((result) => {
              return _.chain(result)
                      .map((item) => {
                        let { ID, CreatedAt } = item
                          , { make_hash }     = item.Spec.Labels
                          ;

                        let now     = (new Date).getTime()
                          , age     = now - (new Date(CreatedAt)).getTime()
                          , expired = age > ms('10m')
                          ;

                        return { id : ID, created_at : CreatedAt, age, expired, make_hash };
                      })
                      .value();
            })
            .then((list) => {
              _.each(list, (item) => {
                let { id, expired, make_hash } = item;

                if (expired) {
                  Sandbox.delete(id);
                  return;
                }

                // todo [akamel] don't just extend. make sure it's the same port otherwise we can have multiple service with same hash that will never delete (timing issue)
                if (make_hash) {
                  make_sdk.extend(make_hash, { ttl : ms('10s') / 1000 });
                }
              });
            });
  }

  static list() {
    return dockerode.listServices();
  }

  static inspect(id) {
    let service = dockerode.getService(id);

    return service.inspect();
  }

  static delete(id) {
    let service = dockerode.getService(id);

    return service.remove();
  }

  static create(name, image, options = {}) {
    let { limits : { idle, memorybytes, nanocpus }, replicas, secret, tailf, blob, filename, make_hash } = options;

    let container_config = {
        sandbox : {
            secret
          , tailf
          , blob
          // , blob_type
          , filename
        }
    };

    let body = {
      "Name": name,
      "TaskTemplate": {
        "ContainerSpec": {
          "Image": image,
          "Env" : [
            `NODE_CONFIG=${JSON.stringify(container_config)}`
          ]

          // "Secrets": [
          //   {
          //     "File": {
          //       "Name": "www.example.org.key",
          //       "UID": "33",
          //       "GID": "33",
          //       "Mode": 384
          //     },
          //     "SecretID": "fpjqlhnwb19zds35k8wn80lq9",
          //     "SecretName": "example_org_domain_key"
          //   }
          // ]
        },
        "Placement": {
          "Constraints" : [
            "node.role != manager"
          ]
        },
        "Resources": {
          "Limits": {
            "MemoryBytes": memorybytes,
            "NanoCPUs" : nanocpus
          }
        },
        "RestartPolicy": {
          "Condition": "any",
          "Delay": ms('1s') * 1000000, // in ns
          "MaxAttempts": 10
        }
      },
      "Mode": {
        "Replicated": {
          "Replicas": replicas
        }
      },
      "EndpointSpec": {
        "Ports": [
          {
            "Protocol": "tcp",
            // "PublishedPort": 8080,
            "TargetPort": 8080
          }
        ]
      },
      "Labels": {
        make_hash
      }
    }

    let serveraddress   = config.get('orchestrator.registry.serveraddress')
      , username        = config.get('orchestrator.registry.username')
      , password        = config.get('orchestrator.registry.password')
      , registryconfig  = { [serveraddress] : { username, password } }
      , authconfig      = { serveraddress, username, password }
      ;

    console.log(authconfig);
    return dockerode.createService(authconfig, body);
  }

  static set(data) {
    let { id } = data;

    return make_sdk.set(data, { ttl : ms('5s') / 1000 });
  }
}

Sandbox.sweep();

setInterval(() => {
  Sandbox.sweep();
}, ms('5s'));

module.exports = Sandbox;
