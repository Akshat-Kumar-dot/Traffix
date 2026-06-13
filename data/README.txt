Drop your experiment files here:

  junction.net.xml            <- your JUN1 net file (export/copy the .net.xml
                                 used by berlin_*.sumocfg)
  rl_model_seed_SI642.pkl     <- trained Q-tables, one per seed
  rl_model_seed_SI6123.pkl
  rl_model_seed_SI6256.pkl
  rl_model_seed_SI6512.pkl
  rl_model_seed_SI61024.pkl

Until junction.net.xml exists the server generates a demo 4-way junction so
you can develop/preview. File names/locations are configurable in
backend/config.py or via TD_NET_FILE / TD_QTABLE_PATTERN env vars.
